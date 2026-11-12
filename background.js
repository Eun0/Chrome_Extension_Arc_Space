// Spaces — background service worker
// 저장 구조 (chrome.storage.local)
//   favorites:     [{ id, url, title, tabId? }]          모든 스페이스 공통 즐겨찾기 (맨 위 아이콘 그리드)
//                  열린 탭은 크롬 고정 탭으로 둔다 → 스페이스를 바꿔도 남는다.
//   spaces:        [{ id, name, icon, color,
//                     pins: [{ id, url, title, tabId?, wasOpen?, wasActive? }],  스페이스 즐겨찾기 (가로선 위)
//                     tabs: [{ url, title, lastAccessed, active }] }]            일반 탭 (가로선 아래)
//                  활성 스페이스의 일반 탭은 실제 창이 원본이고, tabs 배열에는 그 사본을 계속 저장해 둔다
//                  (창을 닫거나 크롬을 꺼도 남도록). 비활성 스페이스는 tabs 배열이 원본.
//   activeSpaceId: string
//   archive:       [{ id, url, title, spaceId, spaceName, closedAt }]
//   settings:      { archiveHours }   0 이면 자동 정리 끔
// chrome.storage.session
//   overrides:     { [tabId]: lastAccessed }  스페이스 전환으로 다시 연 탭의 "원래" 마지막 접근 시각
//   lazy:          { [tabId]: { url, title } } 전환 때 자리표시로 열어 둔 탭의 원래 주소·제목
//   spaceWindow:   windowId  활성 스페이스가 떠 있는 창 (이 창의 일반 탭을 활성 스페이스 tabs 에 저장)
//
// 즐겨찾기(favorites, pins)는 탭을 닫아도 항목이 남고, 자동 정리 대상이 아니다.

const DEFAULTS = { favorites: [], spaces: [], activeSpaceId: null, archive: [], settings: { archiveHours: 24 } };
const ARCHIVE_MAX = 1000;
const SWEEP_MINUTES = 10;

const uid = () => crypto.randomUUID();
const isBlank = (u) => !u || u === 'chrome://newtab/' || u === 'about:blank';
// ---------- 지연 로딩용 자리표시 탭 ----------
// 스페이스를 바꿀 때 바로 볼 탭이 아니면 원래 주소 대신 제목만 있는 data: 페이지로 연다.
// 그 탭을 처음 보는 순간(visibilitychange) 원래 주소로 이동한다. 원래 주소는 URL의 # 뒤에 넣어 둔다.
const LAZY_PREFIX = 'data:text/html;charset=utf-8,';
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function lazyPageUrl(url, title) {
  const html = '<!doctype html><meta charset="utf-8">'
    + `<title>${escHtml(title || url)}</title>`
    + '<style>html{background:#fff}@media(prefers-color-scheme:dark){html{background:#202124}}</style>'
    + '<script>function go(){if(document.visibilityState==="visible")location.replace(decodeURIComponent(location.hash.slice(1)))}'
    + 'document.addEventListener("visibilitychange",go);go();</script>';
  return LAZY_PREFIX + encodeURIComponent(html) + '#' + encodeURIComponent(url);
}
function realUrl(u) {
  if (u && u.startsWith(LAZY_PREFIX) && u.includes('#')) {
    try { return decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)); } catch {}
  }
  return u || '';
}
// 웹 페이지에서 이동할 수 없는 주소(chrome:// 등)는 자리표시를 쓰지 않고 바로 연다
const canLazy = (url) => /^https?:/i.test(url || '');
const tabUrl = (t) => realUrl(t.url || t.pendingUrl || '');
const NO_SPLIT = chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1;
const inSplit = (t) => t.splitViewId != null && t.splitViewId !== NO_SPLIT;

// 모든 상태 변경을 한 줄로 직렬화해서 전환·정리·메시지가 서로 꼬이지 않게 한다.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch((e) => console.error('[spaces]', e));
  return run;
}

async function getState() {
  const st = await chrome.storage.local.get(DEFAULTS);
  for (const s of st.spaces) { s.pins ??= []; s.tabs ??= []; }
  return st;
}
async function getOverrides() {
  const { overrides = {} } = await chrome.storage.session.get('overrides');
  return overrides;
}
const setOverrides = (overrides) => chrome.storage.session.set({ overrides });
async function getLazy() {
  const { lazy = {} } = await chrome.storage.session.get('lazy');
  return lazy;
}
const setLazy = (lazy) => chrome.storage.session.set({ lazy });

const activeOf = (st) => st.spaces.find((s) => s.id === st.activeSpaceId);
const allPins = (st) => [...st.favorites, ...st.spaces.flatMap((s) => s.pins)];
const pinList = (st, kind) => (kind === 'fav' ? st.favorites : activeOf(st)?.pins ?? []);

// 탭이 어떤 즐겨찾기와 연결돼 있으면 연결을 끊는다 (항목 자체는 남김)
function detachTab(st, tabId) {
  let changed = false;
  for (const p of allPins(st)) if (p.tabId === tabId) { delete p.tabId; changed = true; }
  return changed;
}
const pinnedTabIds = (st) => new Set(allPins(st).map((p) => p.tabId).filter((x) => x != null));

async function resolveWindow(windowId) {
  if (windowId) return windowId;
  const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  return w.id;
}

function toSaved(tab, override, lz) {
  let url = tabUrl(tab);
  if (isBlank(url) && lz?.url) url = lz.url;
  const title = (tab.discarded || !tab.title) && lz?.title ? lz.title : tab.title || '';
  return {
    url,
    title,
    lastAccessed: override ?? tab.lastAccessed ?? Date.now(),
    active: !!tab.active,
    ...(inSplit(tab) ? { split: tab.splitViewId } : {}),  // 분할 화면 짝 (다시 열 때 복원)
  };
}

// ---------- 초기화 ----------
async function init() {
  const st = await getState();
  if (!st.spaces.length) {
    const home = { id: uid(), name: 'Home', icon: '', color: '#5b7cfa', pins: [], tabs: [] };
    await chrome.storage.local.set({ spaces: [home], activeSpaceId: home.id });
  } else if (!st.spaces.some((s) => s.id === st.activeSpaceId)) {
    await chrome.storage.local.set({ activeSpaceId: st.spaces[0].id });
  }
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // 재생바용 Media Session 훅. 사이트 접근을 허용한 곳에만 실제로 주입된다.
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: ['media-hook'] }).catch(() => []);
  if (!registered.length) {
    await chrome.scripting.registerContentScripts([{
      id: 'media-hook', js: ['media-hook.js'], matches: ['<all_urls>'],
      runAt: 'document_start', world: 'MAIN', allFrames: false,
    }]).catch((e) => console.warn('[spaces] media-hook', e));
  }
  if (!(await chrome.alarms.get('sweep'))) {
    chrome.alarms.create('sweep', { periodInMinutes: SWEEP_MINUTES });
  }
}

// 브라우저를 다시 켜면 탭 ID가 바뀐다. 즐겨찾기와 복원된 탭을 URL로 다시 연결한다.
async function reattach({ reset }) {
  const st = await getState();
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const liveIds = new Set(tabs.map((t) => t.id));
  for (const p of allPins(st)) {
    if (reset || !liveIds.has(p.tabId)) delete p.tabId;
  }
  const used = pinnedTabIds(st);
  const match = (p, ok) => {
    if (p.tabId != null) return;
    const t = tabs.find((t) => !used.has(t.id) && ok(t) && tabUrl(t) === p.url);
    if (t) { p.tabId = t.id; used.add(t.id); }
  };
  st.favorites.forEach((p) => match(p, (t) => t.pinned));
  activeOf(st)?.pins.forEach((p) => match(p, (t) => !t.pinned));
  // 고정 탭 안에서 다른 페이지로 옮겨 간 경우: 같은 사이트의 고정 탭과 연결
  const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
  for (const p of st.favorites) {
    if (p.tabId != null || !host(p.url)) continue;
    const t = tabs.find((t) => t.pinned && !used.has(t.id) && host(tabUrl(t)) === host(p.url));
    if (t) { p.tabId = t.id; used.add(t.id); }
  }
  const before = await chrome.storage.local.get(['favorites', 'spaces']);
  if (JSON.stringify(before.favorites) === JSON.stringify(st.favorites)
    && JSON.stringify(before.spaces) === JSON.stringify(st.spaces)) return;
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
}
// 탭이 생기거나 고정되거나 주소가 바뀌면 다시 연결 (세션 복원이 늦게 끝나도 따라잡는다)
let relinkTimer = null;
function scheduleRelink() {
  clearTimeout(relinkTimer);
  relinkTimer = setTimeout(() => serial(() => reattach({ reset: false })), 1000);
}

chrome.runtime.onInstalled.addListener(() => {
  serial(init);
  serial(() => reattach({ reset: false }));
  chrome.windows.getLastFocused({ windowTypes: ['normal'] }).then((w) => scheduleAdopt(w.id, 0), () => {});
});
chrome.runtime.onStartup.addListener(() => {
  serial(init);
  serial(() => reattach({ reset: true }));
  // 세션 복원이 늦게 끝나는 경우를 위해 한 번 더
  setTimeout(() => serial(() => reattach({ reset: false })), 5000);
  // 크롬이 세션 복원을 끝낼 때까지 기다렸다가 첫 창에 활성 스페이스를 맡긴다
  startupUntil = Date.now() + 60_000;
  waitRestored().then(async () => {
    startupUntil = 0;
    const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
    if (w) serial(() => adoptWindow(w.id, { startup: true }));
  });
});

// 시작 직후에는 창·탭 수가 3초 동안 그대로일 때까지 기다린다 (최대 30초)
let startupUntil = 0;
async function waitRestored() {
  const count = async () => (await chrome.tabs.query({ windowType: 'normal' })).length;
  let last = -1, stableSince = Date.now();
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    const n = await count();
    if (n !== last) { last = n; stableSince = Date.now(); }
    else if (n > 0 && Date.now() - stableSince >= 3000) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---------- 스페이스 전환 ----------
// 전환 중에는 옛 탭과 새 탭이 잠깐 같이 있다. 사이드패널이 그 중간 상태를 그리지 않도록 표시해 둔다.
async function switchSpace(targetId, windowId) {
  const st = await getState();
  if (targetId === st.activeSpaceId) return;
  const target = st.spaces.find((s) => s.id === targetId);
  if (!target) return;
  await chrome.storage.session.set({ switching: { to: targetId, at: Date.now() } });
  try {
    await doSwitch(st, target, targetId, windowId);
  } finally {
    await chrome.storage.session.remove('switching');
  }
}

async function doSwitch(st, target, targetId, windowId) {
  const current = activeOf(st);
  windowId = await resolveWindow(windowId);

  const overrides = await getOverrides();
  const lazy = await getLazy();
  const all = await chrome.tabs.query({ windowId });
  const live = all.filter((t) => !t.pinned);

  // 1) 현재 스페이스 저장: 스페이스 즐겨찾기 탭은 "열려 있었음"만 기록, 나머지는 일반 탭으로 저장
  if (current) {
    const byTab = new Map(current.pins.filter((p) => p.tabId != null).map((p) => [p.tabId, p]));
    for (const p of current.pins) { delete p.wasOpen; delete p.wasActive; }
    const regular = [];
    for (const t of live) {
      const p = byTab.get(t.id);
      if (p) { p.wasOpen = true; p.wasActive = !!t.active; }
      else {
        const saved = toSaved(t, overrides[t.id], lazy[t.id]);
        if (!isBlank(saved.url)) regular.push(saved);
      }
    }
    for (const p of current.pins) delete p.tabId;
    // 다른 창(활성 스페이스가 없는 창)에서 바꿨다면 저장본을 덮어쓰지 않고 이 창의 탭을 더한다
    if ((await getSpaceWindow()) === windowId) current.tabs = regular;
    else {
      const have = new Set(current.tabs.map((t) => t.url));
      current.tabs = [...current.tabs.map((t) => ({ ...t, active: false })), ...regular.filter((t) => !have.has(t.url))];
    }
  }

  // 2) 대상 스페이스 열기: 열려 있던 즐겨찾기 → 일반 탭 순서 (창이 닫히지 않도록 먼저 연다)
  const toOpen = [
    ...target.pins.filter((p) => p.wasOpen).map((p) => ({ url: p.url, title: p.title, active: p.wasActive, pin: p })),
    ...target.tabs,
  ];
  if (!toOpen.length) toOpen.push({ url: 'chrome://newtab/', active: true });
  for (const t of live) { delete overrides[t.id]; delete lazy[t.id]; }
  const splitPairs = await openSaved(windowId, toOpen, all.length, overrides, lazy);
  for (const p of target.pins) { delete p.wasOpen; delete p.wasActive; }
  // 대상 스페이스의 tabs 는 그대로 둔다: 지금 연 탭과 같은 내용이고, 이후 저장(snapshot)이 갱신한다

  await chrome.storage.local.set({ spaces: st.spaces, activeSpaceId: targetId });
  await setOverrides(overrides);
  await setLazy(lazy);
  await setSpaceWindow(windowId);

  // 3) 이전 스페이스 탭 닫기
  if (live.length) await chrome.tabs.remove(live.map((t) => t.id)).catch(() => {});

  // 4) 분할 화면 복원
  await restoreSplits(splitPairs);
}

// 저장된 탭 목록을 창에 연다. 지금 볼 탭(active)만 바로 로드하고, 나머지는 자리표시로 열어 두었다가 클릭할 때 로드.
// overrides·lazy 는 호출한 쪽에서 저장한다. 반환: 분할 화면으로 다시 묶을 탭 ID 쌍
async function openSaved(windowId, items, base, overrides, lazy) {
  let activeIdx = items.findIndex((t) => t.active);
  if (activeIdx < 0) activeIdx = items.length - 1;
  const splitPairs = new Map();  // 저장된 split 값 → 새로 만든 탭 ID 들
  // 탭은 한꺼번에 연다 (하나씩 기다리면 탭 수만큼 느려진다). 순서는 index 로 고정.
  const createdTabs = await Promise.all(items.map(async (item, i) => {
    const active = i === activeIdx;
    const index = base + i;
    let created = null;
    if (!active && canLazy(item.url)) {
      created = await chrome.tabs.create({ windowId, index, url: lazyPageUrl(item.url, item.title), active: false })
        .catch(() => null);
    }
    return created ?? chrome.tabs.create({ windowId, index, url: item.url, active });
  }));
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const active = i === activeIdx;
    const created = createdTabs[i];
    if (item.pin) item.pin.tabId = created.id;
    // 다시 열었다고 "방금 본 탭"이 되지 않도록, 원래 마지막 접근 시각을 기억해 둔다
    else if (!active && item.lastAccessed) overrides[created.id] = item.lastAccessed;
    if (!active) lazy[created.id] = { url: item.url, title: item.title || '' };
    if (item.split != null && !item.pin) {
      if (!splitPairs.has(item.split)) splitPairs.set(item.split, []);
      splitPairs.get(item.split).push(created.id);
    }
  }
  return splitPairs;
}

async function restoreSplits(splitPairs) {
  if (typeof chrome.tabs.createSplit !== 'function') return;
  for (const ids of splitPairs.values()) {
    if (ids.length === 2) await chrome.tabs.createSplit(ids).catch((e) => console.warn('[spaces] split restore', e));
  }
}

// ---------- 활성 스페이스 탭 계속 저장 ----------
// 활성 스페이스가 떠 있는 창(spaceWindow)의 일반 탭을 활성 스페이스 tabs 에 계속 복사해 둔다.
// 창을 닫으면 마지막 저장본이 남고, 다음에 창을 열면(또는 크롬을 다시 켜면) 빠진 탭을 다시 연다.
async function getSpaceWindow() {
  const { spaceWindow } = await chrome.storage.session.get('spaceWindow');
  if (spaceWindow == null) return null;
  try {
    const w = await chrome.windows.get(spaceWindow);
    return w.type === 'normal' ? w.id : null;
  } catch { return null; }
}
const setSpaceWindow = (id) => chrome.storage.session.set({ spaceWindow: id });

// 창의 일반 탭 → 저장 형식 (공통 즐겨찾기·크롬 고정 탭·스페이스 즐겨찾기 탭·빈 탭 제외)
function regularOf(st, tabs, overrides, lazy) {
  const keep = pinnedTabIds(st);
  return tabs
    .filter((t) => !t.pinned && !keep.has(t.id))
    .map((t) => toSaved(t, overrides[t.id], lazy[t.id]))
    .filter((t) => !isBlank(t.url));
}

async function snapshot() {
  const windowId = await getSpaceWindow();
  if (windowId == null) return;
  const { switching } = await chrome.storage.session.get('switching');
  if (switching) return;
  const st = await getState();
  const sp = activeOf(st);
  if (!sp) return;
  const tabs = await chrome.tabs.query({ windowId });
  const regular = regularOf(st, tabs, await getOverrides(), await getLazy());
  if (JSON.stringify(regular) === JSON.stringify(sp.tabs)) return;
  sp.tabs = regular;
  await chrome.storage.local.set({ spaces: st.spaces });
}
let snapTimer = null;
function scheduleSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => serial(snapshot), 800);
}

// 활성 스페이스를 띄운 창이 없으면 이 창을 맡긴다. 저장본 중 어느 창에도 없는 탭은 이 창에 다시 연다.
// (크롬이 세션을 복원했다면 탭이 이미 있으니 아무것도 열지 않는다)
async function adoptWindow(windowId, { startup = false } = {}) {
  if ((await getSpaceWindow()) != null) return;
  let win;
  try { win = await chrome.windows.get(windowId, { populate: true }); } catch { return; }
  if (win.type !== 'normal' || win.incognito) return;
  const st = await getState();
  const sp = activeOf(st);
  await setSpaceWindow(windowId);
  if (!sp?.tabs.length) return scheduleSnapshot();

  const allTabs = await chrome.tabs.query({ windowType: 'normal' });
  // 크롬을 막 켰는데 일반 탭이 이미 있으면 크롬이 세션을 복원한 것 → 다시 열지 않는다
  if (startup && allTabs.some((t) => !t.pinned && !isBlank(tabUrl(t)))) return scheduleSnapshot();
  const open = new Set(allTabs.map(tabUrl));
  const missing = sp.tabs.filter((t) => !open.has(t.url));
  if (missing.length) {
    const overrides = await getOverrides();
    const lazy = await getLazy();
    // 새 창의 빈 새 탭 하나만 있으면 저장본으로 바꿔 끼운다
    const blanks = win.tabs.filter((t) => !t.pinned && isBlank(tabUrl(t)));
    const onlyBlank = blanks.length && win.tabs.every((t) => t.pinned || isBlank(tabUrl(t)));
    const items = missing.map((t) => ({ ...t, active: onlyBlank ? t.active : false }));
    if (!onlyBlank) items.forEach((t) => { if (!t.lastAccessed) t.lastAccessed = Date.now(); });
    const splitPairs = await openSavedKeepFocus(windowId, items, win.tabs.length, overrides, lazy, !!onlyBlank);
    await setOverrides(overrides);
    await setLazy(lazy);
    if (onlyBlank) await chrome.tabs.remove(blanks.map((t) => t.id)).catch(() => {});
    await restoreSplits(splitPairs);
  }
  scheduleSnapshot();
}
// 창에 이미 보던 탭이 있으면 그 탭을 그대로 보게 둔다 (복원한 탭은 모두 자리표시로)
async function openSavedKeepFocus(windowId, items, base, overrides, lazy, mayActivate) {
  if (mayActivate) return openSaved(windowId, items, base, overrides, lazy);
  const pairs = new Map();
  const created = await Promise.all(items.map((item, i) => chrome.tabs.create({
    windowId, index: base + i, active: false,
    url: canLazy(item.url) ? lazyPageUrl(item.url, item.title) : item.url,
  })));
  items.forEach((item, i) => {
    const id = created[i].id;
    if (item.lastAccessed) overrides[id] = item.lastAccessed;
    if (canLazy(item.url)) lazy[id] = { url: item.url, title: item.title || '' };
    if (item.split != null) {
      if (!pairs.has(item.split)) pairs.set(item.split, []);
      pairs.get(item.split).push(id);
    }
  });
  return pairs;
}
// 창이 막 열렸을 때는 크롬이 세션 탭을 아직 복원 중일 수 있어 잠시 기다린다
function scheduleAdopt(windowId, delay = 1500) {
  if (windowId == null || windowId === chrome.windows.WINDOW_ID_NONE) return;
  if (Date.now() < startupUntil) return;  // 시작 중에는 waitRestored 가 끝난 뒤 한 번만
  setTimeout(() => serial(() => adoptWindow(windowId)), delay);
}

async function createSpace({ space, windowId }) {
  const st = await getState();
  const s = {
    id: uid(),
    name: (space.name || '').trim() || '새 스페이스',
    icon: space.icon || '',
    color: space.color || '#5b7cfa',
    pins: [],
    tabs: [],
  };
  st.spaces.push(s);
  await chrome.storage.local.set({ spaces: st.spaces });
  await switchSpace(s.id, windowId);
}

async function updateSpace({ id, patch }) {
  const st = await getState();
  const s = st.spaces.find((x) => x.id === id);
  if (!s) return;
  for (const k of ['name', 'icon', 'color']) if (k in patch) s[k] = patch[k];
  await chrome.storage.local.set({ spaces: st.spaces });
}

async function deleteSpace({ id, windowId }) {
  let st = await getState();
  if (st.spaces.length <= 1) return;
  if (id === st.activeSpaceId) {
    const other = st.spaces.find((s) => s.id !== id);
    await switchSpace(other.id, windowId);
    st = await getState();
  }
  const sp = st.spaces.find((s) => s.id === id);
  if (!sp) return;
  const now = Date.now();
  const entries = [...sp.pins, ...sp.tabs]
    .filter((t) => !isBlank(t.url))
    .map((t) => ({ id: uid(), url: t.url, title: t.title, spaceId: null, spaceName: sp.name, closedAt: now }));
  await chrome.storage.local.set({
    spaces: st.spaces.filter((s) => s.id !== id),
    archive: [...entries, ...st.archive].slice(0, ARCHIVE_MAX),
  });
}

async function reorderSpace({ id, toIndex }) {
  const st = await getState();
  const from = st.spaces.findIndex((s) => s.id === id);
  if (from < 0) return;
  const [s] = st.spaces.splice(from, 1);
  st.spaces.splice(Math.max(0, Math.min(toIndex, st.spaces.length)), 0, s);
  await chrome.storage.local.set({ spaces: st.spaces });
}

async function moveTab({ tabId, spaceId }) {
  const st = await getState();
  if (spaceId === st.activeSpaceId) return;
  const sp = st.spaces.find((s) => s.id === spaceId);
  if (!sp) return;
  const tab = await chrome.tabs.get(tabId);
  const overrides = await getOverrides();
  const lazy = await getLazy();
  detachTab(st, tabId);
  sp.tabs.push({ ...toSaved(tab, overrides[tabId], lazy[tabId]), active: false });
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });

  const rest = (await chrome.tabs.query({ windowId: tab.windowId })).filter((t) => t.id !== tabId);
  if (!rest.length) await chrome.tabs.create({ windowId: tab.windowId });
  await chrome.tabs.remove(tabId);
}

// ---------- 즐겨찾기 ----------
// kind: 'fav' (공통 즐겨찾기) | 'pin' (현재 스페이스 즐겨찾기)
async function addPin({ kind, tabId, toIndex }) {
  const st = await getState();
  const list = pinList(st, kind);
  const tab = await chrome.tabs.get(tabId);
  detachTab(st, tabId);
  const entry = { id: uid(), url: tabUrl(tab), title: tab.title || '', tabId };
  list.splice(toIndex ?? list.length, 0, entry);
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
  // 공통 즐겨찾기 탭은 크롬 고정 탭으로, 스페이스 즐겨찾기 탭은 일반 탭으로
  if (kind === 'fav' && !tab.pinned) await chrome.tabs.update(tabId, { pinned: true });
  if (kind === 'pin' && tab.pinned) await chrome.tabs.update(tabId, { pinned: false });
}

async function openPin({ kind, pinId, windowId }) {
  const st = await getState();
  const p = pinList(st, kind).find((x) => x.id === pinId);
  if (!p) return;
  if (p.tabId != null) {
    try {
      await chrome.tabs.get(p.tabId);
      await chrome.tabs.update(p.tabId, { active: true });
      return;
    } catch { delete p.tabId; }
  }
  // 연결이 끊겼을 뿐 같은 페이지·사이트 탭이 이미 열려 있으면 새로 열지 않고 그 탭과 다시 연결
  const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
  const used = pinnedTabIds(st);
  const cands = (await chrome.tabs.query({ windowType: 'normal' }))
    .filter((t) => !used.has(t.id) && t.pinned === (kind === 'fav'));
  const found = cands.find((t) => tabUrl(t) === p.url)
    || (kind === 'fav' && host(p.url) && cands.find((t) => host(tabUrl(t)) === host(p.url)));
  if (found) {
    p.tabId = found.id;
    await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
    await chrome.windows.update(found.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(found.id, { active: true });
    return;
  }
  const t = await chrome.tabs.create({
    windowId: await resolveWindow(windowId), url: p.url, active: true, pinned: kind === 'fav',
  });
  p.tabId = t.id;
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
}

async function closePinTab({ kind, pinId }) {
  const st = await getState();
  const p = pinList(st, kind).find((x) => x.id === pinId);
  if (p?.tabId == null) return;
  const tabId = p.tabId;
  delete p.tabId;
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
  await chrome.tabs.remove(tabId).catch(() => {});
}

async function removePin({ kind, pinId }) {
  const st = await getState();
  const list = pinList(st, kind);
  const i = list.findIndex((x) => x.id === pinId);
  if (i < 0) return;
  const [p] = list.splice(i, 1);
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
  // 열린 탭은 일반 탭으로 남긴다
  if (kind === 'fav' && p.tabId != null) await chrome.tabs.update(p.tabId, { pinned: false }).catch(() => {});
}

async function resetPin({ kind, pinId }) {
  const st = await getState();
  const p = pinList(st, kind).find((x) => x.id === pinId);
  if (p?.tabId != null) await chrome.tabs.update(p.tabId, { url: p.url }).catch(() => {});
}

async function updatePinUrl({ kind, pinId }) {
  const st = await getState();
  const p = pinList(st, kind).find((x) => x.id === pinId);
  if (p?.tabId == null) return;
  const t = await chrome.tabs.get(p.tabId);
  p.url = tabUrl(t);
  p.title = t.title || p.title;
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
}

// 즐겨찾기 아이콘 직접 지정: { type: 'emoji', value } | { type: 'image', value: dataURL } | null(사이트 기본)
async function setPinIcon({ kind, pinId, icon }) {
  const st = await getState();
  const p = pinList(st, kind).find((x) => x.id === pinId);
  if (!p) return;
  if (icon) p.icon = icon; else delete p.icon;
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
}

// 공통 즐겨찾기 ↔ 스페이스 고정 사이로 옮기기 (열린 탭은 그대로 유지)
async function movePin({ fromKind, pinId, toKind, toIndex }) {
  const st = await getState();
  const from = pinList(st, fromKind);
  const to = pinList(st, toKind);
  const i = from.findIndex((x) => x.id === pinId);
  if (i < 0) return;
  const [p] = from.splice(i, 1);
  to.splice(Math.max(0, Math.min(toIndex ?? to.length, to.length)), 0, p);
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
  if (p.tabId != null) await chrome.tabs.update(p.tabId, { pinned: toKind === 'fav' }).catch(() => {});
}

async function reorderPin({ kind, pinId, toIndex }) {
  const st = await getState();
  const list = pinList(st, kind);
  const from = list.findIndex((x) => x.id === pinId);
  if (from < 0) return;
  const [p] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, p);
  await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
}

// ---------- 자동 아카이브 ----------
async function sweep() {
  const st = await getState();
  const hours = Number(st.settings.archiveHours) || 0;
  if (!hours) return 0;
  const cutoff = Date.now() - hours * 3600 * 1000;
  const now = Date.now();
  const overrides = await getOverrides();
  const activeSpace = activeOf(st);
  const keepIds = pinnedTabIds(st);

  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  // 지금 보이는 분할 화면의 반대쪽 탭도 "보고 있는 탭"으로 친다
  const visibleSplits = new Set(tabs.filter((t) => t.active && inSplit(t)).map((t) => t.splitViewId));
  const stale = tabs.filter((t) => {
    if (t.pinned || t.active || t.audible || keepIds.has(t.id)) return false;
    if (inSplit(t) && visibleSplits.has(t.splitViewId)) return false;
    const last = overrides[t.id] ?? t.lastAccessed;
    return typeof last === 'number' && last < cutoff;
  });

  const entries = stale
    .filter((t) => !isBlank(tabUrl(t)))
    .map((t) => ({
      id: uid(), url: tabUrl(t), title: t.title || '',
      spaceId: activeSpace?.id ?? null, spaceName: activeSpace?.name ?? '', closedAt: now,
    }));

  // 비활성 스페이스에 저장된 일반 탭도 같은 기준으로 정리 (스페이스 즐겨찾기는 제외)
  let storedChanged = false;
  for (const sp of st.spaces) {
    if (sp.id === st.activeSpaceId) continue;
    const keep = [];
    for (const t of sp.tabs) {
      if (typeof t.lastAccessed === 'number' && t.lastAccessed < cutoff) {
        if (!isBlank(t.url)) entries.push({ id: uid(), url: t.url, title: t.title, spaceId: sp.id, spaceName: sp.name, closedAt: now });
        storedChanged = true;
      } else keep.push(t);
    }
    if (keep.length && !keep.some((t) => t.active) && !sp.pins.some((p) => p.wasActive)) keep[keep.length - 1].active = true;
    sp.tabs = keep;
  }

  if (!entries.length && !stale.length && !storedChanged) return 0;
  await chrome.storage.local.set({
    spaces: st.spaces,
    archive: [...entries, ...st.archive].slice(0, ARCHIVE_MAX),
  });
  if (stale.length) await chrome.tabs.remove(stale.map((t) => t.id)).catch(() => {});
  return entries.length;
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sweep') serial(sweep);
});

async function restore({ entryId, windowId }) {
  const st = await getState();
  const entry = st.archive.find((a) => a.id === entryId);
  if (!entry) return;
  await chrome.storage.local.set({ archive: st.archive.filter((a) => a.id !== entryId) });
  await chrome.tabs.create({ windowId: await resolveWindow(windowId), url: entry.url, active: true });
}

async function removeArchive({ entryId }) {
  const st = await getState();
  await chrome.storage.local.set({ archive: st.archive.filter((a) => a.id !== entryId) });
}

async function clearArchive() {
  await chrome.storage.local.set({ archive: [] });
}

async function setSettings({ patch }) {
  const st = await getState();
  await chrome.storage.local.set({ settings: { ...st.settings, ...patch } });
}

// ---------- 탭 이벤트 ----------
// 직접 본 탭은 override 해제
chrome.tabs.onActivated.addListener(({ tabId }) =>
  serial(async () => {
    const o = await getOverrides();
    if (tabId in o) { delete o[tabId]; await setOverrides(o); }
  })
);
// 닫힌 탭: override 정리, 즐겨찾기 연결 해제 (항목은 남음)
chrome.tabs.onRemoved.addListener((tabId) =>
  serial(async () => {
    const o = await getOverrides();
    if (tabId in o) { delete o[tabId]; await setOverrides(o); }
    const lz = await getLazy();
    if (tabId in lz) { delete lz[tabId]; await setLazy(lz); }
    const st = await getState();
    if (detachTab(st, tabId)) await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
  })
);
// 언로드 등으로 탭 ID가 바뀌면 연결 정보를 새 ID로 옮긴다
chrome.tabs.onReplaced.addListener((added, removed) =>
  serial(async () => {
    const o = await getOverrides();
    if (removed in o) { o[added] = o[removed]; delete o[removed]; await setOverrides(o); }
    const lz = await getLazy();
    if (removed in lz) { lz[added] = lz[removed]; delete lz[removed]; await setLazy(lz); }
    const st = await getState();
    let changed = false;
    for (const p of allPins(st)) if (p.tabId === removed) { p.tabId = added; changed = true; }
    if (changed) await chrome.storage.local.set({ favorites: st.favorites, spaces: st.spaces });
  })
);
// 크롬 탭 바에서 공통 즐겨찾기 탭의 고정을 풀면 연결 해제
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.pinned !== false) return;
  serial(async () => {
    const st = await getState();
    const f = st.favorites.find((p) => p.tabId === tabId);
    if (f) { delete f.tabId; await chrome.storage.local.set({ favorites: st.favorites }); }
  });
});

// 활성 스페이스 탭 저장: 탭이 바뀔 때마다 (잠깐 모았다가) 저장. 창을 닫느라 닫힌 탭은 저장본에서 빼지 않는다.
chrome.tabs.onCreated.addListener(() => { scheduleSnapshot(); scheduleRelink(); });
chrome.tabs.onRemoved.addListener((_id, info) => { if (!info.isWindowClosing) scheduleSnapshot(); });
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url || info.title || 'pinned' in info || info.splitViewId !== undefined) scheduleSnapshot();
  if (info.url || info.pinned) scheduleRelink();
});
for (const ev of ['onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[ev].addListener(scheduleSnapshot);
// 활성 스페이스 창이 닫힌 뒤 다른 창을 쓰거나 새 창을 열면 그 창이 이어받는다
chrome.windows.onCreated.addListener((w) => { if (w.type === 'normal') scheduleAdopt(w.id); });
chrome.windows.onFocusChanged.addListener((id) => scheduleAdopt(id, 300));
chrome.windows.onRemoved.addListener((id) =>
  serial(async () => {
    const { spaceWindow } = await chrome.storage.session.get('spaceWindow');
    if (spaceWindow === id) await setSpaceWindow(null);
  })
);

// ---------- 단축키 ----------
// 사이드패널이 열린 창 추적: 패널이 열리면 포트를 연결하고, 닫히면 끊긴다.
const openPanels = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith('panel:')) return;
  const windowId = Number(port.name.slice(6));
  openPanels.add(windowId);
  port.onDisconnect.addListener(() => openPanels.delete(windowId));
});

// sidePanel.open()은 사용자 동작 직후에만 허용되므로 await 없이 바로 호출한다.
function togglePanel(tab) {
  const windowId = tab?.windowId;
  if (windowId == null) return;
  if (openPanels.has(windowId) && chrome.sidePanel.close) {
    chrome.sidePanel.close({ windowId }).catch((e) => console.warn('[spaces] close', e));
  } else {
    chrome.sidePanel.open({ windowId }).catch((e) => console.warn('[spaces] open', e));
  }
}

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd === 'toggle-panel') return togglePanel(tab);
  if (cmd !== 'next-space' && cmd !== 'prev-space') return;
  serial(async () => {
    const st = await getState();
    const n = st.spaces.length;
    if (n < 2) return;
    const i = st.spaces.findIndex((s) => s.id === st.activeSpaceId);
    const j = (i + (cmd === 'next-space' ? 1 : -1) + n) % n;
    await switchSpace(st.spaces[j].id);
  });
});

// ---------- 사이드패널 메시지 ----------
const handlers = {
  switch: (m) => switchSpace(m.spaceId, m.windowId),
  createSpace,
  updateSpace,
  deleteSpace,
  reorderSpace,
  moveTab,
  addPin,
  openPin,
  closePinTab,
  removePin,
  resetPin,
  updatePinUrl,
  reorderPin,
  movePin,
  setPinIcon,
  restore,
  removeArchive,
  clearArchive,
  setSettings,
  sweepNow: sweep,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return;
  serial(() => h(msg)).then(
    (result) => sendResponse({ ok: true, result }),
    (e) => sendResponse({ ok: false, error: String(e) })
  );
  return true;
});
