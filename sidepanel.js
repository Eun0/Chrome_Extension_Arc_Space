// Spaces — 사이드패널 UI
const COLORS = ['#5b7cfa', '#8b5cf6', '#e0559b', '#e5484d', '#f08c2e', '#d9a514', '#30a46c', '#12a3a3', '#6b7280'];
const HOURS = [
  [0, '끄기'], [6, '6시간'], [12, '12시간'], [24, '24시간 (기본)'], [72, '3일'], [168, '7일'],
];

const S = {
  favorites: [], spaces: [], activeSpaceId: null, archive: [], settings: { archiveHours: 24 },
  windowId: null, tabs: [], lazy: {},
  media: [],            // 최근에 소리가 났던 탭 ID (최신순) → 미니 플레이어 대상
  playOverride: {},     // { [tabId]: { playing, at } } 버튼을 누른 직후 재생 상태 (audible 반영이 늦어서)
  view: 'tabs',         // 'tabs' | 'archive' | 'settings'
  q: '',                // 아카이브 검색어
  editor: null,         // { id|null, name, icon, color, confirmDelete }
  iconEditor: null,     // { kind, pinId, url, emoji, image } 즐겨찾기 아이콘 바꾸기
  menu: null,           // { x, y, items }
  confirmClear: false,
};

// ---------- 유틸 ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const send = (type, data = {}) => chrome.runtime.sendMessage({ type, windowId: S.windowId, ...data });
const fav = (url) => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url || '')}&size=32`;
// 언로드해 둔 탭은 주소·제목이 비어 있을 수 있어서 저장해 둔 값으로 보완한다
// 지연 로딩 자리표시 탭(data:...#원래주소)은 원래 주소로 바꿔서 보여 준다
const LAZY_PREFIX = 'data:text/html;charset=utf-8,';
function realUrl(u) {
  if (u && u.startsWith(LAZY_PREFIX) && u.includes('#')) {
    try { return decodeURIComponent(u.slice(u.lastIndexOf('#') + 1)); } catch {}
  }
  return u || '';
}
const tabUrl = (t) => {
  const u = realUrl(t?.url || t?.pendingUrl || '');
  return (!u || u === 'about:blank') && t && S.lazy[t.id]?.url ? S.lazy[t.id].url : u;
};
const tabTitle = (t) => ((t.discarded || !t.title) && S.lazy[t.id]?.title) || t.title || hostOf(tabUrl(t));
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') || url; } catch { return url || ''; } };
const noHash = (u) => (u || '').split('#')[0];
const activeSpace = () => S.spaces.find((s) => s.id === S.activeSpaceId) || S.spaces[0];
const firstGrapheme = (s) => {
  s = (s || '').trim();
  if (!s) return '';
  const seg = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  return seg.segment(s)[Symbol.iterator]().next().value?.segment || '';
};
const spaceLabel = (s) => s.icon || firstGrapheme(s.name).toUpperCase();
const hasType = (e, t) => [...e.dataTransfer.types].includes(t);
const pad = (n) => String(n).padStart(2, '0');

// 드래그 데이터: 탭 = 'text/x-tab' (tabId), 즐겨찾기 = 'text/x-pin' ('fav:<id>' | 'pin:<id>'), 스페이스 = 'text/x-space'
const dragTabId = (e) => Number(e.dataTransfer.getData('text/x-tab')) || null;
const dragPin = (e) => {
  const v = e.dataTransfer.getData('text/x-pin');
  if (!v) return null;
  const [kind, id] = v.split(':');
  return { kind, id };
};
function dropTarget(accept, onDrop) {
  return {
    ondragover: (e) => {
      if (!accept(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.add('drop');
    },
    ondragleave: (e) => e.currentTarget.classList.remove('drop'),
    ondrop: (e) => {
      if (!accept(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('drop');
      onDrop(e);
    },
  };
}

const ICONS = {
  archive: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.8" y="2.5" width="12.4" height="3.2" rx="1"/><path d="M3 5.7v6.8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.7M6.3 8.6h3.4" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M6.7 1.6h2.6l.4 1.7c.4.1.8.3 1.1.6l1.7-.5 1.3 2.2-1.3 1.2a4 4 0 0 1 0 1.4l1.3 1.2-1.3 2.2-1.7-.5c-.3.3-.7.5-1.1.6l-.4 1.7H6.7l-.4-1.7c-.4-.1-.8-.3-1.1-.6l-1.7.5-1.3-2.2 1.3-1.2a4 4 0 0 1 0-1.4L2.2 5.6l1.3-2.2 1.7.5c.3-.3.7-.5 1.1-.6z"/><circle cx="8" cy="8" r="2"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3 5 8l5 5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
};
const icon = (name) => h('span', { html: ICONS[name], style: 'display:grid' });

// ---------- 데이터 ----------
const STATE_KEYS = { favorites: [], spaces: [], activeSpaceId: null, archive: [], settings: { archiveHours: 24 } };
async function loadState() {
  Object.assign(S, await chrome.storage.local.get(STATE_KEYS));
}
async function loadLazy() {
  ({ lazy: S.lazy = {} } = await chrome.storage.session.get('lazy'));
}
async function loadTabs() {
  S.tabs = await chrome.tabs.query({ windowId: S.windowId });
  const ids = new Set(S.tabs.map((t) => t.id));
  for (const t of S.tabs) {
    if (t.audible) S.media = [t.id, ...S.media.filter((id) => id !== t.id)];
    const o = S.playOverride[t.id];
    if (o && (o.playing === !!t.audible || Date.now() - o.at > 5000)) delete S.playOverride[t.id];
  }
  S.media = S.media.filter((id) => ids.has(id));
}
let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => { await loadTabs(); render(); }, 60);
}

// ---------- 렌더 ----------
// 마우스를 누르고 있는 동안 화면을 다시 그리면 누른 요소가 교체돼서 클릭이 씹힌다.
// 누르는 동안 들어온 렌더는 미뤘다가 손을 뗀 뒤에 한 번만 그린다.
// 드래그 중에도 마찬가지로 미룬다 (끄는 요소·놓을 자리가 바뀌면 드롭이 실패한다).
let pointerDown = false, dragging = false, renderPending = false;
const flushRender = () => {
  if (pointerDown || dragging || !renderPending) return;
  renderPending = false;
  setTimeout(render, 0);
};
const releasePointer = () => { pointerDown = false; flushRender(); };
const endDrag = () => { dragging = false; document.body.classList.remove('dragging-tab'); flushRender(); };
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', releasePointer, true);
document.addEventListener('pointercancel', releasePointer, true);
document.addEventListener('dragstart', () => { dragging = true; }, true);
document.addEventListener('dragend', endDrag, true);
document.addEventListener('drop', () => setTimeout(endDrag, 0), true);
window.addEventListener('blur', () => { releasePointer(); });

function render() {
  if (pointerDown || dragging) { renderPending = true; return; }
  const focused = document.activeElement;
  const fid = focused?.id;
  let caret = null;
  try { caret = focused?.selectionStart; } catch {}

  const sp = activeSpace();
  document.documentElement.style.setProperty('--space', sp?.color || COLORS[0]);
  const app = document.getElementById('app');
  app.replaceChildren(...[
    S.view === 'archive' ? renderArchive() : S.view === 'settings' ? renderSettings() : renderTabs(sp),
    renderPlayer(),
    renderDock(),
    S.editor ? renderEditor() : null,
    S.iconEditor ? renderIconEditor() : null,
    S.menu ? renderMenu() : null,
  ].filter(Boolean));

  if (fid) {
    const n = document.getElementById(fid);
    if (n) { n.focus(); if (caret != null) try { n.setSelectionRange(caret, caret); } catch {} }
  }
}

function renderTabs(sp) {
  const byId = new Map(S.tabs.map((t) => [t.id, t]));
  const favIds = new Set(S.favorites.map((f) => f.tabId).filter((x) => x != null));
  const pins = sp?.pins || [];
  const pinIds = new Set(pins.map((p) => p.tabId).filter((x) => x != null));
  // 즐겨찾기가 아닌데 크롬에서 직접 고정한 탭도 맨 위 그리드에 함께 보여 준다
  const strayPinned = S.tabs.filter((t) => t.pinned && !favIds.has(t.id));
  const normal = S.tabs.filter((t) => !t.pinned && !pinIds.has(t.id) && !favIds.has(t.id));

  return h('main', { class: 'main' },
    renderFavGrid(byId, strayPinned),
    h('header', {
      class: 'space-head', ondblclick: () => openEditor(sp),
      // 스페이스 이름 위에 놓으면 스페이스 고정 맨 위에 추가
      ...dropTarget(
        (e) => hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin'),
        (e) => {
          const tabId = dragTabId(e);
          if (tabId) return send('addPin', { kind: 'pin', tabId, toIndex: 0 });
          const d = dragPin(e);
          if (d?.kind === 'fav') send('movePin', { fromKind: 'fav', pinId: d.id, toKind: 'pin', toIndex: 0 });
          else if (d?.kind === 'pin') send('reorderPin', { kind: 'pin', pinId: d.id, toIndex: 0 });
        },
      ),
    },
      h('span', { class: 'space-name' }, sp?.name || ''),
      h('button', { class: 'icon-btn', title: '스페이스 편집', onclick: () => openEditor(sp) }, icon('more')),
    ),
    pins.length ? h('ul', { class: 'tabs pin-list' }, pins.map((p, i) => pinRow(p, i, byId.get(p.tabId)))) : null,
    // 가로선: 위는 스페이스 즐겨찾기(정리 안 됨), 아래는 일반 탭(자동 정리 대상)
    h('div', {
      class: 'divider-zone', title: '여기로 끌어 놓으면 스페이스 즐겨찾기 맨 끝에 추가',
      ...dropTarget(
        (e) => hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin'),
        (e) => {
          const tabId = dragTabId(e);
          if (tabId) return send('addPin', { kind: 'pin', tabId });
          const d = dragPin(e);
          if (d?.kind === 'fav') send('movePin', { fromKind: 'fav', pinId: d.id, toKind: 'pin' });
          else if (d?.kind === 'pin') send('reorderPin', { kind: 'pin', pinId: d.id, toIndex: 1e9 });
        },
      ),
    }, h('div', { class: 'divider' })),
    h('button', {
      class: 'newtab', onclick: () => chrome.tabs.create({ windowId: S.windowId }),
      ...dropTarget((e) => hasType(e, 'text/x-pin'), (e) => unpinToRegular(dragPin(e))),
    }, h('span', { class: 'plus' }, '+'), '새 탭'),
    h('ul', { class: 'tabs tab-list' }, groupSplits(normal).map((g) => (g.length === 2 ? splitRow(g[0], g[1]) : tabRow(g[0])))),
    normal.length ? null : h('p', { class: 'empty' }, '열린 탭이 없어요.'),
    // 목록 아래 빈 공간: 즐겨찾기를 끌어 놓으면 일반 탭으로
    h('div', { class: 'tail', ...dropTarget((e) => hasType(e, 'text/x-pin'), (e) => unpinToRegular(dragPin(e))) }),
  );
}

// 즐겨찾기(공통·스페이스)를 가로선 아래로 끌어내리면 일반 탭이 된다. 닫혀 있던 항목은 열어서 남긴다.
function unpinToRegular(pin) {
  if (!pin) return;
  const list = pin.kind === 'fav' ? S.favorites : activeSpace()?.pins;
  const p = list?.find((x) => x.id === pin.id);
  if (!p) return;
  if (p.tabId == null) send('openPin', { kind: pin.kind, pinId: p.id });
  send('removePin', { kind: pin.kind, pinId: p.id });
}

// ---------- 공통 즐겨찾기 (맨 위 그리드) ----------
function renderFavGrid(byId, strayPinned) {
  const empty = !S.favorites.length && !strayPinned.length;
  return h('div', {
    // 비어 있으면 평소엔 숨기고, 탭을 끄는 동안에만 놓을 자리로 보여 준다
    class: 'pins' + (empty ? ' fav-empty' : ''),
    ...dropTarget(
      (e) => hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin'),
      (e) => {
        const tabId = dragTabId(e);
        if (tabId) return send('addPin', { kind: 'fav', tabId });
        const d = dragPin(e);
        if (d?.kind === 'pin') send('movePin', { fromKind: 'pin', pinId: d.id, toKind: 'fav' });
        else if (d?.kind === 'fav') send('reorderPin', { kind: 'fav', pinId: d.id, toIndex: 1e9 });
      },
    ),
  },
    empty ? h('span', { class: 'fav-drop' }, '여기에 놓으면 모든 스페이스 즐겨찾기') : null,
    S.favorites.map((f, i) => favTile(f, i, byId.get(f.tabId))),
    strayPinned.map(strayTile),
  );
}

function favTile(f, i, tab) {
  return h('button', {
    class: 'pin' + (tab?.active ? ' active' : '') + (tab ? ' open' : ''),
    title: f.title || f.url, draggable: 'true',
    onclick: () => send('openPin', { kind: 'fav', pinId: f.id }),
    oncontextmenu: (e) => { e.preventDefault(); openMenu(e, pinMenuItems('fav', f, tab)); },
    ondragstart: (e) => { e.dataTransfer.setData('text/x-pin', `fav:${f.id}`); e.currentTarget.classList.add('dragging'); },
    ondragend: (e) => e.currentTarget.classList.remove('dragging'),
    ...dropTarget(
      (e) => hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin'),
      (e) => {
        const tabId = dragTabId(e);
        if (tabId) return send('addPin', { kind: 'fav', tabId, toIndex: i });
        const p = dragPin(e);
        if (p?.kind === 'fav' && p.id !== f.id) send('reorderPin', { kind: 'fav', pinId: p.id, toIndex: i });
        else if (p?.kind === 'pin') send('movePin', { fromKind: 'pin', pinId: p.id, toKind: 'fav', toIndex: i });
      },
    ),
  }, pinIcon(f, f.url));
}

function strayTile(t) {
  return h('button', {
    class: 'pin open' + (t.active ? ' active' : ''), title: `${t.title || t.url}\n(크롬 고정 탭 · 우클릭해서 공통 즐겨찾기에 추가)`,
    draggable: 'true',
    onclick: () => chrome.tabs.update(t.id, { active: true }),
    ondragstart: (e) => e.dataTransfer.setData('text/x-tab', String(t.id)),
    oncontextmenu: (e) => {
      e.preventDefault();
      openMenu(e, [
        { label: '공통 즐겨찾기에 추가', run: () => send('addPin', { kind: 'fav', tabId: t.id }) },
        { label: '고정 해제', run: () => chrome.tabs.update(t.id, { pinned: false }) },
        'sep',
        { label: '닫기', run: () => chrome.tabs.remove(t.id) },
      ]);
    },
  }, h('img', { src: fav(tabUrl(t)), alt: '' }));
}

// ---------- 스페이스 즐겨찾기 (가로선 위) ----------
function pinRow(p, i, tab) {
  const navigated = tab && tabUrl(tab) && noHash(tabUrl(tab)) !== noHash(p.url);
  return h('li', {
    class: 'tab pinrow' + (tab?.active ? ' active' : '') + (tab ? ' open' : ''),
    title: navigated ? `${p.url}\n지금: ${tabUrl(tab)}` : p.url, draggable: 'true',
    onclick: () => send('openPin', { kind: 'pin', pinId: p.id }),
    onauxclick: (e) => { if (e.button === 1 && tab) send('closePinTab', { kind: 'pin', pinId: p.id }); },
    oncontextmenu: (e) => { e.preventDefault(); openMenu(e, pinMenuItems('pin', p, tab)); },
    ondragstart: (e) => { e.dataTransfer.setData('text/x-pin', `pin:${p.id}`); e.currentTarget.classList.add('dragging'); },
    ondragend: (e) => e.currentTarget.classList.remove('dragging'),
    ...dropTarget(
      (e) => hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin'),
      (e) => {
        const tabId = dragTabId(e);
        if (tabId) return send('addPin', { kind: 'pin', tabId, toIndex: i });
        const d = dragPin(e);
        if (d?.kind === 'pin' && d.id !== p.id) send('reorderPin', { kind: 'pin', pinId: d.id, toIndex: i });
        else if (d?.kind === 'fav') send('movePin', { fromKind: 'fav', pinId: d.id, toKind: 'pin', toIndex: i });
      },
    ),
  },
    p.icon ? pinIcon(p, p.url, 'fav') : h('img', { class: 'fav', src: fav(navigated ? tabUrl(tab) : p.url), alt: '' }),
    h('span', { class: 'title' },
      navigated ? [h('span', { class: 'slash' }, '/ '), tabTitle(tab)] : (p.title || hostOf(p.url)),
    ),
    tab?.audible ? h('span', { class: 'audio', title: '소리 재생 중' }, '♪') : null,
    tab ? h('button', {
      class: 'close', title: '탭 닫기 (즐겨찾기는 남아요)',
      onclick: (e) => { e.stopPropagation(); send('closePinTab', { kind: 'pin', pinId: p.id }); },
    }, '×') : null,
  );
}

function pinMenuItems(kind, p, tab) {
  const navigated = tab && noHash(tabUrl(tab)) !== noHash(p.url);
  return [
    tab && { label: '탭 닫기 (즐겨찾기는 유지)', run: () => send('closePinTab', { kind, pinId: p.id }) },
    navigated && { label: '원래 주소로 돌아가기', run: () => send('resetPin', { kind, pinId: p.id }) },
    navigated && { label: '지금 주소로 즐겨찾기 바꾸기', run: () => send('updatePinUrl', { kind, pinId: p.id }) },
    (tab || navigated) && 'sep',
    { label: '아이콘 바꾸기', run: () => openIconEditor(kind, p) },
    'sep',
    { label: kind === 'fav' ? '공통 즐겨찾기에서 제거' : '스페이스 즐겨찾기에서 제거', run: () => send('removePin', { kind, pinId: p.id }) },
  ];
}

// ---------- 일반 탭 (가로선 아래, 자동 정리 대상) ----------
function tabRow(t) {
  return h('li', {
    class: 'tab' + (t.active ? ' active' : ''), draggable: 'true', title: tabUrl(t),
    onclick: () => chrome.tabs.update(t.id, { active: true }),
    onauxclick: (e) => { if (e.button === 1) chrome.tabs.remove(t.id); },
    oncontextmenu: (e) => { e.preventDefault(); openMenu(e, tabMenuItems(t)); },
    ondragstart: (e) => {
      e.dataTransfer.setData('text/x-tab', String(t.id));
      e.dataTransfer.effectAllowed = 'move';
      e.currentTarget.classList.add('dragging');
    },
    ondragend: (e) => e.currentTarget.classList.remove('dragging'),
    ...tabDropHandlers(t),
  },
    h('img', { class: 'fav', src: fav(tabUrl(t)), alt: '' }),
    h('span', { class: 'title' }, tabTitle(t)),
    t.audible ? h('span', { class: 'audio', title: '소리 재생 중' }, '♪') : null,
    h('button', {
      class: 'close', title: '탭 닫기',
      onclick: (e) => { e.stopPropagation(); chrome.tabs.remove(t.id); },
    }, '×'),
  );
}

// ---------- 분할 화면 (Chrome 155+ Split View) ----------
const SPLIT_OK = typeof chrome.tabs.createSplit === 'function';
const NO_SPLIT = chrome.tabs.SPLIT_VIEW_ID_NONE ?? -1;
const inSplit = (t) => t.splitViewId != null && t.splitViewId !== NO_SPLIT;

// 같은 분할 화면에 묶인 일반 탭 두 개는 한 줄로 합친다
function groupSplits(tabs) {
  const out = [], used = new Set();
  for (const t of tabs) {
    if (used.has(t.id)) continue;
    const partner = inSplit(t) && tabs.find((x) => x.id !== t.id && x.splitViewId === t.splitViewId);
    if (partner) { used.add(partner.id); out.push(t.index < partner.index ? [t, partner] : [partner, t]); }
    else out.push([t]);
  }
  return out;
}

async function splitTabs(dragId, targetId) {
  try {
    const src = await chrome.tabs.get(dragId);
    if (inSplit(src)) await chrome.tabs.unsplit(src.splitViewId);
    const tgt = await chrome.tabs.get(targetId);
    if (src.pinned || tgt.pinned || inSplit(tgt)) return;
    // 분할하려면 두 탭이 붙어 있어야 한다 → 끌어온 탭을 대상 탭 바로 오른쪽으로
    const idx = src.index < tgt.index ? tgt.index : tgt.index + 1;
    await chrome.tabs.move(dragId, { index: idx });
    await chrome.tabs.createSplit([targetId, dragId]);
    await chrome.tabs.update(targetId, { active: true });
  } catch (e) {
    console.warn('[spaces] split', e);
  }
}

// 탭 줄 위에 놓기: 가운데 절반 = 분할 화면, 위·아래 가장자리 = 순서 바꾸기
function tabDropHandlers(t) {
  const accepts = (e) => hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin');
  const zoneOf = (e) => {
    if (!SPLIT_OK || !hasType(e, 'text/x-tab') || inSplit(t)) return 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y > 0.25 && y < 0.75 ? 'split' : 'move';
  };
  const clear = (el) => el.classList.remove('drop', 'drop-split');
  return {
    ondragover: (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = zoneOf(e);
      e.currentTarget.classList.toggle('drop', zone === 'move');
      e.currentTarget.classList.toggle('drop-split', zone === 'split');
    },
    ondragleave: (e) => clear(e.currentTarget),
    ondrop: (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const zone = zoneOf(e);
      clear(e.currentTarget);
      const id = dragTabId(e);
      if (id) {
        if (id === t.id) return;
        if (zone === 'split') splitTabs(id, t.id);
        else chrome.tabs.move(id, { index: t.index });
        return;
      }
      unpinToRegular(dragPin(e));
    },
  };
}

function splitRow(a, b) {
  const half = (t) => h('span', {
    class: 'half' + (t.active ? ' on' : ''), title: tabUrl(t),
    onclick: (e) => { e.stopPropagation(); chrome.tabs.update(t.id, { active: true }); },
    onauxclick: (e) => { if (e.button === 1) { e.stopPropagation(); chrome.tabs.remove(t.id); } },
  },
    h('img', { class: 'fav', src: fav(tabUrl(t)), alt: '' }),
    h('span', { class: 'title' }, tabTitle(t)),
  );
  return h('li', {
    class: 'tab split' + (a.active || b.active ? ' active' : ''),
    oncontextmenu: (e) => {
      e.preventDefault();
      openMenu(e, [
        { label: '분할 해제', run: () => chrome.tabs.unsplit(a.splitViewId) },
        'sep',
        { label: '둘 다 닫기', run: () => chrome.tabs.remove([a.id, b.id]) },
      ]);
    },
    ...dropTarget((e) => hasType(e, 'text/x-pin'), (e) => unpinToRegular(dragPin(e))),
  }, half(a), h('span', { class: 'split-sep' }), half(b));
}

function tabMenuItems(t) {
  const others = S.spaces.filter((s) => s.id !== S.activeSpaceId);
  return [
    { label: '스페이스 즐겨찾기에 추가', run: () => send('addPin', { kind: 'pin', tabId: t.id }) },
    { label: '공통 즐겨찾기에 추가', run: () => send('addPin', { kind: 'fav', tabId: t.id }) },
    { label: '복제', run: () => chrome.tabs.duplicate(t.id) },
    inSplit(t) && { label: '분할 해제', run: () => chrome.tabs.unsplit(t.splitViewId) },
    others.length && 'sep',
    others.length && { header: '다른 스페이스로 이동' },
    ...others.map((s) => ({ label: s.name, dot: s.color, run: () => send('moveTab', { tabId: t.id, spaceId: s.id }) })),
    'sep',
    { label: '닫기', run: () => chrome.tabs.remove(t.id) },
  ];
}

// ---------- 미니 플레이어 ----------
// 소리가 났던 탭을 보고 있지 않을 때 하단에 재생 컨트롤을 띄운다.
const PLAYER_ICONS = {
  prev: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="1.8" height="10" rx=".6"/><path d="M13 3.6v8.8a.6.6 0 0 1-.92.5L5.6 8.5a.6.6 0 0 1 0-1l6.48-4.4a.6.6 0 0 1 .92.5Z"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="11.2" y="3" width="1.8" height="10" rx=".6"/><path d="M3 3.6v8.8a.6.6 0 0 0 .92.5l6.48-4.4a.6.6 0 0 0 0-1L3.92 3.1A.6.6 0 0 0 3 3.6Z"/></svg>',
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.9v10.2a.7.7 0 0 0 1.06.6l8.1-5.1a.7.7 0 0 0 0-1.2l-8.1-5.1a.7.7 0 0 0-1.06.6Z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.8" y="2.8" width="2.8" height="10.4" rx=".8"/><rect x="9.4" y="2.8" width="2.8" height="10.4" rx=".8"/></svg>',
  vol: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor"/><path d="M10.6 5.8a3 3 0 0 1 0 4.4M12.4 4a5.5 5.5 0 0 1 0 8"/></svg>',
  muted: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor"/><path d="m10.5 6 3.5 4M14 6l-3.5 4"/></svg>',
};

// 탭 안에서 실행되는 함수 (chrome.scripting.executeScript 로 주입). 바깥 변수를 쓰면 안 된다.
// 반환값: 무엇으로 처리했는지 ('button' | 'media' | 'none')
function mediaControl(action) {
  const SITES = {
    'music.youtube.com': {
      toggle: ['#play-pause-button', 'ytmusic-player-bar .play-pause-button'],
      next: ['ytmusic-player-bar .next-button', '.next-button'],
      prev: ['ytmusic-player-bar .previous-button', '.previous-button'],
    },
    'www.youtube.com': {
      next: ['.ytp-next-button'],
      prev: ['.ytp-prev-button'],
    },
    'open.spotify.com': {
      toggle: ['[data-testid="control-button-playpause"]'],
      next: ['[data-testid="control-button-skip-forward"]'],
      prev: ['[data-testid="control-button-skip-back"]'],
    },
    'soundcloud.com': {
      toggle: ['.playControl'],
      next: ['.skipControl__next'],
      prev: ['.skipControl__previous'],
    },
  };
  // 사이트 목록에 없으면 버튼 이름(aria-label/title)으로 찾는다
  const LABELS = {
    next: /^(next|next (song|track|video|episode)|skip( forward)?|다음|다음 (곡|트랙|동영상|노래))(?![A-Za-z])/i,
    prev: /^(previous|prev|previous (song|track|video|episode)|skip back|이전|이전 (곡|트랙|동영상|노래))(?![A-Za-z])/i,
    toggle: /^(play|pause|재생|일시정지|일시중지)(?![A-Za-z])/i,
  };
  // 1) 사이트가 등록한 Media Session 동작 (media-hook.js). 숨은 탭에서도 미디어 키처럼 바로 동작한다.
  const SESSION = { next: 'nexttrack', prev: 'previoustrack' };
  if (action === 'toggle') {
    const m = [...document.querySelectorAll('video, audio')].find((x) => !x.paused);
    const sessionAction = m || navigator.mediaSession?.playbackState === 'playing' ? 'pause' : 'play';
    if (window.__spacesMedia?.(sessionAction)) return 'session';
  } else if (window.__spacesMedia?.(SESSION[action])) {
    return 'session';
  }

  // 2) 훅이 없으면 (훅 등록 전에 열린 탭) 페이지의 버튼을 직접 누른다
  const visible = (el) => el && el.getClientRects().length > 0 && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const pick = (sel) => [...document.querySelectorAll(sel)].find(visible);

  for (const sel of (SITES[location.hostname] || {})[action] || []) {
    const el = pick(sel);
    if (el) { (el.querySelector('button') || el).click(); return 'button'; }
  }
  const byLabel = [...document.querySelectorAll('button, [role="button"], a.ytp-button')]
    .find((el) => visible(el) && LABELS[action].test((el.getAttribute('aria-label') || el.getAttribute('title') || '').trim()));
  if (byLabel && action !== 'toggle') { byLabel.click(); return 'button'; }

  if (action === 'toggle') {
    const medias = [...document.querySelectorAll('video, audio')];
    const m = medias.find((x) => !x.paused) || medias[0];
    if (m) { m.paused ? m.play() : m.pause(); return 'media'; }
    if (byLabel) { byLabel.click(); return 'button'; }
  }
  return 'none';
}

function controlMedia(t, action) {
  let origin;
  try { origin = new URL(tabUrl(t)).origin + '/*'; } catch { return; }
  // permissions.request 는 클릭 직후에 바로 불러야 한다 (이미 허용된 사이트면 묻지 않고 통과)
  chrome.permissions.request({ origins: [origin] }).then(async (ok) => {
    if (!ok) return;
    if (action === 'toggle') {
      const playing = S.playOverride[t.id]?.playing ?? !!t.audible;
      S.playOverride[t.id] = { playing: !playing, at: Date.now() };
      render();
    }
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: t.id }, world: 'MAIN', func: mediaControl, args: [action],
      });
      if (res?.result === 'none') console.warn('[spaces] media control not found:', action, tabUrl(t));
    } catch (e) {
      console.warn('[spaces] media', e);
    }
  });
}


function renderPlayer() {
  const byId = new Map(S.tabs.map((t) => [t.id, t]));
  const t = S.media.map((id) => byId.get(id)).find((x) => x && !x.active);
  if (!t) return null;
  const playing = S.playOverride[t.id]?.playing ?? !!t.audible;
  const muted = !!t.mutedInfo?.muted;
  // 누르는 순간 바로 실행 (키보드로 누를 때는 click 으로 처리)
  const btn = (name, title, run) =>
    h('button', {
      class: 'pbtn', title,
      onpointerdown: (e) => { if (e.button === 0) { e.preventDefault(); run(); } },
      onclick: (e) => { if (e.detail === 0) run(); },
    }, h('span', { html: PLAYER_ICONS[name], style: 'display:grid' }));
  // 마우스를 올리면 위로 펼쳐지며 재생 중인 제목 표시.
  // 다시 그려져도 펼친 상태가 유지되도록 상태로 들고 있고, 클래스는 직접 토글해서 깜빡임을 막는다.
  return h('div', {
    class: 'player' + (S.playerHover ? ' expanded' : ''),
    onmouseenter: (e) => { S.playerHover = true; e.currentTarget.classList.add('expanded'); },
    onmouseleave: (e) => { S.playerHover = false; e.currentTarget.classList.remove('expanded'); },
  },
    h('div', { class: 'ptitle', title: tabTitle(t) }, tabTitle(t)),
    h('div', { class: 'prow' },
    h('button', {
      class: 'pbtn psrc', title: `${tabTitle(t)}\n클릭하면 이 탭으로 이동`,
      onclick: () => chrome.tabs.update(t.id, { active: true }),
      oncontextmenu: (e) => {
        e.preventDefault();
        openMenu(e, [{ label: '플레이어 숨기기', run: () => { S.media = S.media.filter((id) => id !== t.id); } }]);
      },
    }, h('img', { src: fav(tabUrl(t)), alt: '' })),
    // 이전·재생·다음은 한 덩어리: 패널이 넓어져도 셋 사이 간격은 그대로
    h('div', { class: 'pgroup' },
      btn('prev', '이전', () => controlMedia(t, 'prev')),
      btn(playing ? 'pause' : 'play', playing ? '일시정지' : '재생', () => controlMedia(t, 'toggle')),
      btn('next', '다음', () => controlMedia(t, 'next')),
    ),
    btn(muted ? 'muted' : 'vol', muted ? '음소거 해제' : '음소거', () => chrome.tabs.update(t.id, { muted: !muted })),
    ),
  );
}

// ---------- 하단 독 ----------
function renderDock() {
  return h('footer', { class: 'dock' },
    h('button', {
      class: 'icon-btn' + (S.view === 'archive' ? ' on' : ''), title: '아카이브',
      onclick: () => { S.view = S.view === 'archive' ? 'tabs' : 'archive'; S.confirmClear = false; render(); },
    }, icon('archive')),
    h('div', { class: 'spaces' },
      S.spaces.map(spaceBtn),
      h('button', { class: 'space add', title: '새 스페이스', onclick: () => openEditor(null) }, '+'),
    ),
    h('button', {
      class: 'icon-btn' + (S.view === 'settings' ? ' on' : ''), title: '설정',
      onclick: () => { S.view = S.view === 'settings' ? 'tabs' : 'settings'; S.sweepMsg = null; render(); },
    }, icon('gear')),
  );
}

function spaceBtn(s, i) {
  const isActive = s.id === S.activeSpaceId;
  return h('button', {
    class: 'space' + (isActive ? ' on' : ''), style: `--c:${s.color}`, title: s.name, draggable: 'true',
    onclick: () => {
      S.view = 'tabs';
      if (!isActive) send('switch', { spaceId: s.id }); else render();
    },
    oncontextmenu: (e) => { e.preventDefault(); openEditor(s); },
    ondragstart: (e) => e.dataTransfer.setData('text/x-space', s.id),
    ...dropTarget(
      (e) => (hasType(e, 'text/x-tab') && !isActive) || hasType(e, 'text/x-space'),
      (e) => {
        const tabId = dragTabId(e);
        if (tabId) return send('moveTab', { tabId, spaceId: s.id });
        const id = e.dataTransfer.getData('text/x-space');
        if (id && id !== s.id) send('reorderSpace', { id, toIndex: i });
      },
    ),
  }, spaceLabel(s));
}

// ---------- 아카이브 ----------
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function renderArchive() {
  const q = S.q.trim().toLowerCase();
  const items = S.archive.filter((a) => !q || `${a.title} ${a.url}`.toLowerCase().includes(q));
  const groups = [];
  for (const a of items) {
    const label = dayLabel(a.closedAt);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, list: [] });
    groups[groups.length - 1].list.push(a);
  }
  const colorOf = (a) => S.spaces.find((s) => s.id === a.spaceId)?.color;

  return h('main', { class: 'main' },
    h('header', { class: 'space-head' },
      h('button', { class: 'icon-btn', title: '탭 목록으로', onclick: () => { S.view = 'tabs'; render(); } }, icon('back')),
      h('span', { class: 'space-name' }, '아카이브'),
      h('span', { class: 'count' }, `${S.archive.length}개`),
    ),
    h('input', {
      id: 'arc-q', class: 'search', type: 'search', placeholder: '제목이나 주소로 검색', value: S.q,
      oninput: (e) => { S.q = e.target.value; render(); },
    }),
    S.archive.length === 0
      ? h('p', { class: 'empty' }, `${S.settings.archiveHours ? S.settings.archiveHours + '시간 동안 안 본 탭' : '자동 정리된 탭'}이 여기에 모여요. 클릭하면 다시 열립니다.`)
      : items.length === 0 ? h('p', { class: 'empty' }, '검색 결과가 없어요.') : null,
    groups.map((g) => [
      h('div', { class: 'group-label' }, g.label),
      h('ul', { class: 'tabs' }, g.list.map((a) => {
        const d = new Date(a.closedAt);
        const c = colorOf(a);
        return h('li', { class: 'tab arch', title: `${a.url}\n클릭하면 현재 스페이스에 다시 열어요`, onclick: () => send('restore', { entryId: a.id }) },
          h('img', { class: 'fav', src: fav(a.url), alt: '' }),
          h('span', { class: 'arch-text' },
            h('span', { class: 'title' }, a.title || hostOf(a.url)),
            h('span', { class: 'meta' }, `${hostOf(a.url)} · ${pad(d.getHours())}:${pad(d.getMinutes())}${a.spaceName ? ' · ' + a.spaceName : ''}`),
          ),
          c ? h('span', { class: 'sdot', style: `background:${c}` }) : null,
          h('button', {
            class: 'close', title: '아카이브에서 지우기',
            onclick: (e) => { e.stopPropagation(); send('removeArchive', { entryId: a.id }); },
          }, '×'),
        );
      })),
    ]),
    S.archive.length ? h('div', { class: 'foot-row' },
      h('button', {
        class: 'btn danger',
        onclick: () => {
          if (S.confirmClear) { S.confirmClear = false; send('clearArchive'); }
          else { S.confirmClear = true; render(); }
        },
      }, S.confirmClear ? '한 번 더 누르면 전부 지워요' : '아카이브 비우기'),
    ) : null,
  );
}

// ---------- 설정 ----------
// 지금 정리하기: 몇 개를 정리했는지, 없으면 가장 오래 안 본 일반 탭이 몇 시간 전인지 알려 준다
async function sweepNow() {
  const hours = Number(S.settings.archiveHours) || 0;
  if (!hours) { S.sweepMsg = '자동 정리가 꺼져 있어요.'; render(); return; }
  const res = await send('sweepNow');
  const n = res?.result || 0;
  if (n) {
    S.sweepMsg = `탭 ${n}개를 아카이브로 옮겼어요.`;
  } else {
    const { overrides = {} } = await chrome.storage.session.get('overrides');
    const keep = new Set([...S.favorites, ...(activeSpace()?.pins || [])].map((p) => p.tabId));
    const ages = S.tabs
      .filter((t) => !t.pinned && !t.active && !t.audible && !keep.has(t.id))
      .map((t) => overrides[t.id] ?? t.lastAccessed)
      .filter((x) => typeof x === 'number');
    if (!ages.length) S.sweepMsg = '정리할 일반 탭이 없어요.';
    else {
      const h = Math.floor((Date.now() - Math.min(...ages)) / 3600000);
      S.sweepMsg = `${hours}시간 넘게 안 본 탭이 없어요. 가장 오래된 탭은 ${h < 1 ? '1시간 안' : h + '시간'} 전에 봤어요.`;
    }
  }
  render();
}

// 크롬에 실제로 지정된 단축키 (chrome://extensions/shortcuts 에서 바꾼 값)
function loadCommands() {
  chrome.commands?.getAll?.().then((list) => { S.commands = list; render(); }).catch(() => {});
}
const SHORTCUT_ROWS = [
  ['toggle-panel', '사이드패널 열기 · 닫기'],
  ['prev-space', '이전 스페이스'],
  ['next-space', '다음 스페이스'],
];
const HOUR_LABELS = { 0: '끄기', 6: '6시간', 12: '12시간', 24: '24시간', 72: '3일', 168: '7일' };

function renderSettings() {
  if (!S.commands) loadCommands();
  const hours = Number(S.settings.archiveHours) || 0;
  const keyOf = (name) => S.commands?.find((c) => c.name === name)?.shortcut || '';
  const keys = (str) => str
    // macOS 는 "⌥⇧→" 처럼 기호가 붙어서, Windows 는 "Ctrl+B" 처럼 + 로 이어서 온다
    ? h('span', { class: 'keys' }, (str.includes('+') ? str.split('+') : [...str]).map((k) => h('kbd', {}, k)))
    : h('span', { class: 'nokey' }, '지정 안 됨');

  return h('main', { class: 'main' },
    h('header', { class: 'space-head' },
      h('button', { class: 'icon-btn', title: '탭 목록으로', onclick: () => { S.view = 'tabs'; render(); } }, icon('back')),
      h('span', { class: 'space-name' }, '설정'),
    ),
    h('div', { class: 'settings' },
      h('section', { class: 'set-group' },
        h('h3', { class: 'set-title' }, '안 본 탭 자동 정리'),
        h('p', { class: 'set-desc' },
          hours ? `가로선 아래 일반 탭 중 ${HOUR_LABELS[hours] || hours + '시간'} 동안 안 본 탭을 아카이브로 옮겨요.` : '자동 정리가 꺼져 있어요.'),
        h('div', { class: 'seg-row', role: 'radiogroup', 'aria-label': '정리 기준 시간' },
          HOURS.map(([v]) => h('button', {
            class: 'seg-opt' + (hours === v ? ' on' : ''), role: 'radio', 'aria-checked': String(hours === v),
            onclick: () => { S.sweepMsg = null; send('setSettings', { patch: { archiveHours: v } }); },
          }, HOUR_LABELS[v]))),
        h('p', { class: 'set-note' }, '즐겨찾기, 지금 보는 탭, 소리 나는 탭은 닫지 않아요.'),
        h('div', { class: 'sweep-row' },
          h('button', { class: 'btn-tint', onclick: sweepNow, disabled: !hours }, '지금 정리하기'),
          S.sweepMsg ? h('span', { class: 'set-note' }, S.sweepMsg) : null,
        ),
      ),
      h('section', { class: 'set-group' },
        h('h3', { class: 'set-title' }, '단축키'),
        h('ul', { class: 'key-list' },
          SHORTCUT_ROWS.map(([name, label]) => h('li', {}, h('span', {}, label), keys(keyOf(name)))),
          h('li', {}, h('span', {}, '스페이스 넘기기'), h('span', { class: 'nokey' }, '사이드패널 위에서 가로 스크롤')),
        ),
        h('button', { class: 'btn-tint', onclick: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }) }, '단축키 바꾸기'),
      ),
    ),
  );
}

// ---------- 스페이스 편집 ----------
function openEditor(sp) {
  S.menu = null;
  S.editor = sp
    ? { id: sp.id, name: sp.name, icon: sp.icon || '', color: sp.color, confirmDelete: false }
    : { id: null, name: '', icon: '', color: COLORS[S.spaces.length % COLORS.length], confirmDelete: false };
  render();
  const n = document.getElementById('ed-name');
  n?.focus(); n?.select();
}
function closeEditor() { S.editor = null; render(); }

function renderEditor() {
  const e = S.editor;
  const canDelete = e.id && S.spaces.length > 1;
  const save = (ev) => {
    ev.preventDefault();
    const name = e.name.trim() || '새 스페이스';
    const patch = { name, icon: firstGrapheme(e.icon), color: e.color };
    if (e.id) send('updateSpace', { id: e.id, patch });
    else send('createSpace', { space: patch });
    S.view = 'tabs';
    closeEditor();
  };
  return h('div', {
    class: 'overlay',
    onclick: (ev) => { if (ev.target === ev.currentTarget) closeEditor(); },
  },
    h('form', { class: 'sheet', onsubmit: save },
      h('div', { class: 'icon-head' },
        // 하단 독에 보일 모습 미리보기 (선택된 상태 + 선택 안 된 상태)
        h('div', { class: 'space-preview' },
          h('span', { class: 'space on', style: `--c:${e.color}` }, spaceLabel({ icon: firstGrapheme(e.icon), name: e.name.trim() || '새' })),
          h('span', { class: 'space', style: `--c:${e.color}` }, spaceLabel({ icon: firstGrapheme(e.icon), name: e.name.trim() || '새' })),
        ),
        h('h2', {}, e.id ? '스페이스 편집' : '새 스페이스'),
      ),
      h('label', { for: 'ed-name' }, '이름'),
      h('input', { id: 'ed-name', type: 'text', maxlength: '24', value: e.name, placeholder: '예: 업무', oninput: (ev) => { e.name = ev.target.value; render(); } }),
      h('label', { for: 'ed-icon' }, '아이콘 (이모지나 글자 하나, 비우면 이름 첫 글자)'),
      h('input', { id: 'ed-icon', type: 'text', maxlength: '8', value: e.icon, oninput: (ev) => { e.icon = ev.target.value; render(); } }),
      h('label', {}, '색'),
      h('div', { class: 'swatches' }, COLORS.map((c) => h('button', {
        type: 'button', class: 'sw' + (c === e.color ? ' on' : ''), style: `--c:${c}`, 'aria-label': `색 ${c}`,
        onclick: () => { e.color = c; render(); },
      }))),
      h('div', { class: 'row' },
        canDelete ? h('button', {
          type: 'button', class: 'btn danger',
          onclick: () => {
            if (e.confirmDelete) { send('deleteSpace', { id: e.id }); closeEditor(); }
            else { e.confirmDelete = true; render(); }
          },
        }, e.confirmDelete ? '한 번 더 누르면 삭제' : '삭제') : h('span'),
        h('div', { class: 'row-r' },
          h('button', { type: 'button', class: 'btn ghost', onclick: closeEditor }, '취소'),
          h('button', { type: 'submit', class: 'btn primary' }, e.id ? '저장' : '만들기'),
        ),
      ),
      e.confirmDelete ? h('p', { class: 'hint' }, '이 스페이스의 즐겨찾기와 저장된 탭은 아카이브로 옮겨져요.') : null,
    ),
  );
}

// ---------- 즐겨찾기 아이콘 ----------
// p.icon: { type: 'emoji', value } | { type: 'image', value: dataURL } | { type: 'tile', text, bg, fg } | 없음(사이트 파비콘)
function pinIcon(p, url, cls) {
  const ic = p.icon;
  const extra = cls ? ' ' + cls : '';
  if (ic?.type === 'emoji') return h('span', { class: 'emoji-icon' + extra }, ic.value);
  if (ic?.type === 'image') return h('img', { class: 'custom-icon' + extra, src: ic.value, alt: '' });
  if (ic?.type === 'tile') {
    return h('span', {
      class: 'tile-icon' + extra + ([...(ic.text || '')].length > 1 ? ' two' : ''),
      style: `background:${ic.bg};color:${ic.fg}`,
    }, ic.text || '');
  }
  return h('img', { class: cls || null, src: fav(url), alt: '' });
}

const TEXT_COLORS = ['#ffffff', '#1d1e22', '#fde68a', '#bfdbfe'];
const graphemes = (s, n) => {
  const seg = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  return [...seg.segment((s || '').trim())].slice(0, n).map((x) => x.segment).join('');
};

function openIconEditor(kind, p) {
  const ic = p.icon;
  S.iconEditor = {
    kind, pinId: p.id, url: p.url,
    mode: ic?.type || 'default',   // 'default' | 'emoji' | 'image' | 'tile'
    emoji: ic?.type === 'emoji' ? ic.value : '',
    image: ic?.type === 'image' ? ic.value : null,
    tile: ic?.type === 'tile'
      ? { text: ic.text, bg: ic.bg, fg: ic.fg }
      : { text: graphemes((p.title || hostOf(p.url)).replace(/^www\./, ''), 1).toUpperCase(), bg: COLORS[0], fg: '#ffffff' },
  };
  render();
}
function closeIconEditor() { S.iconEditor = null; render(); }

// 고른 이미지를 64x64 정사각형으로 잘라 data URL 로 저장 (용량 작게)
function imageToIcon(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const N = 64, c = document.createElement('canvas');
      c.width = c.height = N;
      const k = Math.max(N / img.width, N / img.height);
      const w = img.width * k, hgt = img.height * k;
      c.getContext('2d').drawImage(img, (N - w) / 2, (N - hgt) / 2, w, hgt);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function iconFromEditor(e) {
  if (e.mode === 'emoji' && firstGrapheme(e.emoji)) return { type: 'emoji', value: firstGrapheme(e.emoji) };
  if (e.mode === 'image' && e.image) return { type: 'image', value: e.image };
  if (e.mode === 'tile') return { type: 'tile', text: graphemes(e.tile.text, 2), bg: e.tile.bg, fg: e.tile.fg };
  return null;
}

function colorRow(id, colors, value, onPick) {
  return h('div', { class: 'swatches' },
    colors.map((c) => h('button', {
      type: 'button', class: 'sw' + (c.toLowerCase() === value.toLowerCase() ? ' on' : ''), style: `--c:${c}`,
      'aria-label': `색 ${c}`, onclick: () => onPick(c),
    })),
    // 직접 고르기
    h('label', { class: 'sw custom' + (colors.some((c) => c.toLowerCase() === value.toLowerCase()) ? '' : ' on'), style: `--c:${value}`, title: '직접 고르기' },
      h('input', { id, type: 'color', value, onchange: (ev) => onPick(ev.target.value) })),
  );
}

function renderIconEditor() {
  const e = S.iconEditor;
  const preview = iconFromEditor(e);
  const save = (ev) => {
    ev.preventDefault();
    send('setPinIcon', { kind: e.kind, pinId: e.pinId, icon: preview });
    closeIconEditor();
  };
  const tab = (mode, label) => h('button', {
    type: 'button', class: 'seg' + (e.mode === mode ? ' on' : ''),
    onclick: () => { e.mode = mode; render(); },
  }, label);

  let body = null;
  if (e.mode === 'emoji') {
    body = [
      h('label', { for: 'ic-emoji' }, '이모지나 글자 하나'),
      h('input', { id: 'ic-emoji', type: 'text', maxlength: '8', value: e.emoji, placeholder: '예: 🎵', oninput: (ev) => { e.emoji = ev.target.value; render(); } }),
    ];
  } else if (e.mode === 'image') {
    body = [
      h('label', { for: 'ic-file' }, '이미지 파일 (정사각형으로 잘려요)'),
      h('input', {
        id: 'ic-file', type: 'file', accept: 'image/*',
        onchange: async (ev) => {
          const f = ev.target.files?.[0];
          if (!f) return;
          try { e.image = await imageToIcon(f); render(); } catch (err) { console.warn('[spaces] icon', err); }
        },
      }),
    ];
  } else if (e.mode === 'tile') {
    body = [
      h('label', { for: 'ic-text' }, '글자 (2자까지)'),
      h('input', { id: 'ic-text', type: 'text', maxlength: '8', value: e.tile.text, placeholder: '예: N', oninput: (ev) => { e.tile.text = ev.target.value; render(); } }),
      h('label', {}, '배경색'),
      colorRow('ic-bg', COLORS, e.tile.bg, (c) => { e.tile.bg = c; render(); }),
      h('label', {}, '글자색'),
      colorRow('ic-fg', TEXT_COLORS, e.tile.fg, (c) => { e.tile.fg = c; render(); }),
    ];
  }

  return h('div', { class: 'overlay', onclick: (ev) => { if (ev.target === ev.currentTarget) closeIconEditor(); } },
    h('form', { class: 'sheet', onsubmit: save },
      h('div', { class: 'icon-head' },
        h('div', { class: 'pin icon-preview' }, pinIcon({ icon: preview }, e.url)),
        h('h2', {}, '아이콘 바꾸기'),
      ),
      h('div', { class: 'segs' }, tab('default', '기본'), tab('tile', '색 블록'), tab('emoji', '이모지'), tab('image', '이미지')),
      body,
      h('div', { class: 'row' },
        h('span'),
        h('div', { class: 'row-r' },
          h('button', { type: 'button', class: 'btn ghost', onclick: closeIconEditor }, '취소'),
          h('button', { type: 'submit', class: 'btn primary' }, '저장'),
        ),
      ),
    ),
  );
}

// ---------- 우클릭 메뉴 ----------
// items: { label, run, dot? } | { header } | 'sep' | falsy(무시)
function openMenu(e, items) {
  S.menu = { x: e.clientX, y: e.clientY, items: items.filter(Boolean) };
  render();
}
function closeMenu() { S.menu = null; render(); }

function renderMenu() {
  const { x, y, items } = S.menu;
  const menu = h('div', { class: 'menu', style: `left:${x}px; top:${y}px` },
    items.map((it) => {
      if (it === 'sep') return h('div', { class: 'sep' });
      if (it.header) return h('div', { class: 'label' }, it.header);
      return h('button', { onclick: () => { closeMenu(); it.run(); } },
        it.dot ? h('span', { class: 'sdot', style: `background:${it.dot}` }) : null, it.label);
    }),
  );
  const overlay = h('div', {
    class: 'overlay clear',
    onclick: (ev) => { if (ev.target === ev.currentTarget) closeMenu(); },
    oncontextmenu: (ev) => { ev.preventDefault(); closeMenu(); },
  }, menu);
  // 화면 밖으로 나가지 않게 위치 보정
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > innerWidth - 8) menu.style.left = `${Math.max(8, innerWidth - r.width - 8)}px`;
    if (r.bottom > innerHeight - 8) menu.style.top = `${Math.max(8, innerHeight - r.height - 8)}px`;
  });
  return overlay;
}

// ---------- 가로 스크롤로 스페이스 전환 ----------
// MX Master 사이드 휠, 트랙패드 좌우 스와이프, Shift+휠 모두 가로 스크롤(deltaX)로 들어온다.
// 한 번 스크롤할 때 한 칸만 넘어가도록, 전환 후에는 스크롤이 잠깐 멈출 때까지 무시한다.
const WHEEL_THRESHOLD = 40;
const WHEEL_GAP_MS = 220;
let wheelAcc = 0, wheelLocked = false, wheelLast = 0;
document.addEventListener('wheel', (e) => {
  if (S.editor || S.menu) return;
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  e.preventDefault();
  const now = performance.now();
  if (now - wheelLast > WHEEL_GAP_MS) { wheelLocked = false; wheelAcc = 0; }
  wheelLast = now;
  if (wheelLocked) return;
  wheelAcc += e.deltaX;
  if (Math.abs(wheelAcc) < WHEEL_THRESHOLD) return;
  const dir = wheelAcc > 0 ? 1 : -1;
  wheelAcc = 0;
  wheelLocked = true;
  const i = S.spaces.findIndex((s) => s.id === S.activeSpaceId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= S.spaces.length) return;  // 양 끝에서는 멈춤 (순환하지 않음)
  S.view = 'tabs';
  send('switch', { spaceId: S.spaces[j].id });
}, { passive: false });

// 탭을 끄는 동안 body 에 표시 → 비어 있는 즐겨찾기 영역을 드러낸다
document.addEventListener('dragstart', (e) => {
  // dragstart 안에서 바로 레이아웃을 바꾸면 크롬이 드래그를 취소할 수 있어서 한 박자 늦춘다
  if (hasType(e, 'text/x-tab') || hasType(e, 'text/x-pin')) {
    setTimeout(() => { if (dragging) document.body.classList.add('dragging-tab'); }, 0);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (S.menu) closeMenu();
  else if (S.iconEditor) closeIconEditor();
  else if (S.editor) closeEditor();
  else if (S.view !== 'tabs') { S.view = 'tabs'; render(); }
});

// ---------- 시작 ----------
(async () => {
  S.windowId = (await chrome.windows.getCurrent()).id;
  // 백그라운드에 "이 창에 패널 열림"을 알린다. 서비스 워커가 재시작되면 다시 연결.
  const connect = () => chrome.runtime.connect({ name: `panel:${S.windowId}` }).onDisconnect.addListener(() => setTimeout(connect, 500));
  connect();
  await loadState();
  await loadLazy();
  await loadTabs();
  render();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session') {
      if (changes.lazy) { S.lazy = changes.lazy.newValue || {}; render(); }
      return;
    }
    if (area !== 'local') return;
    for (const k of Object.keys(STATE_KEYS)) {
      if (changes[k]) S[k] = changes[k].newValue;
    }
    render();
  });
  for (const ev of ['onCreated', 'onUpdated', 'onRemoved', 'onMoved', 'onActivated', 'onAttached', 'onDetached', 'onReplaced']) {
    chrome.tabs[ev].addListener(refresh);
  }
})();
