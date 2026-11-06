// 장면별 상태 만들기. sidepanel.js 의 전역(S, render, openEditor ...)을 그대로 쓴다.
setTimeout(() => {
  const scene = window.__mockScene;
  const rowByTitle = (text) => [...document.querySelectorAll('.tab')].find((el) => el.textContent.includes(text));

  switch (scene) {
    case 'player':
      S.playerHover = true;
      render();
      break;
    case 'archive':
      S.view = 'archive';
      render();
      break;
    case 'settings':
      S.view = 'settings';
      render();
      break;
    case 'menu': {
      const t = S.tabs.find((x) => x.id === 22);
      S.menu = { x: 70, y: 395, items: tabMenuItems(t).filter(Boolean) };
      render();
      break;
    }
    case 'pin-menu': {
      const sp = activeSpace();
      const p = sp.pins[2];
      S.menu = { x: 70, y: 215, items: pinMenuItems('pin', p, S.tabs.find((x) => x.id === p.tabId)).filter(Boolean) };
      render();
      break;
    }
    case 'space-editor':
      openEditor(activeSpace());
      break;
    case 'icon-editor': {
      openIconEditor('fav', S.favorites[7]);
      render();
      break;
    }
    case 'split':
      render();
      setTimeout(() => rowByTitle('arc 대체')?.classList.add('drop-split'), 50);
      break;
    case 'drag':
      render();
      setTimeout(() => {
        document.body.classList.add('dragging-tab');
        rowByTitle('Helium')?.classList.add('dragging');
        document.querySelector('.divider-zone')?.classList.add('drop');
      }, 50);
      break;
    case 'rects': {
      // 화면 구성 그림에 박스를 그리기 위한 영역 좌표 (CSS px)
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); };
      const out = { fav: r('.pins'), head: r('.space-head'), pins: r('.pin-list'), newtab: r('.newtab'), tabs: r('.tab-list'), player: r('.player'), dock: r('.dock'), H: innerHeight };
      const pre = document.createElement('pre'); pre.id = 'rects'; pre.textContent = JSON.stringify(out); document.body.append(pre);
      break;
    }
    default:
      if (scene.startsWith('anim-')) runAnim(scene.slice(5), Number(new URLSearchParams(location.search).get('f') || 0));
      break;
  }
}, 300);

// ---------- 드래그 GIF 프레임 ----------
// 프레임 f: 0 = 커서가 원래 탭 위, 1 = 눌러서 끌기 시작, 2~13 = 이동, 14 = 대상 위에서 강조, 15 = 놓은 결과
const LAST_MOVE = 13, HOVER = 14, RESULT = 15;
const $q = (sel) => document.querySelector(sel);
const rowOf = (text) => [...document.querySelectorAll('.tab')].find((el) => el.textContent.includes(text));
const centerOf = (el, dx = 0, dy = 0) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 + dx, y: r.top + r.height / 2 + dy }; };
const grabOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + Math.min(70, r.width / 2), y: r.top + r.height / 2 }; };
const tabById = (id) => S.tabs.find((t) => t.id === id);

const ANIMS = {
  // 일반 탭 → 가로선 위 = 이 스페이스에 고정
  pin: {
    src: () => rowOf('Helium'), target: () => $q('.divider-zone'), hl: 'drop',
    apply: () => {
      const t = tabById(24);
      activeSpace().pins.push({ id: 'pn', url: t.url, title: t.title, tabId: 24 });
    },
  },
  // 일반 탭 → 맨 위 아이콘 영역 = 공통 즐겨찾기
  fav: {
    src: () => rowOf('chrome.tabs'), target: () => $q('.pins'), hl: 'drop',
    point: () => { const tiles = document.querySelectorAll('.pins .pin'); return centerOf(tiles[tiles.length - 1], 56, 0); },
    apply: () => {
      const t = tabById(21);
      t.pinned = true;
      S.favorites.push({ id: 'fn', url: t.url, title: t.title, tabId: 21 });
    },
  },
  // 스페이스 고정 → 가로선 아래 = 일반 탭으로
  unpin: {
    src: () => rowOf('Pull requests'), target: () => $q('.tail'), hl: 'drop',
    point: () => { const r = $q('.tail').getBoundingClientRect(); return { x: r.left + 90, y: r.top + 24 }; },
    apply: () => { const sp = activeSpace(); sp.pins = sp.pins.filter((p) => p.id !== 'p3'); },
  },
  // 일반 탭 → 하단 스페이스 아이콘 = 그 스페이스로 이동
  move: {
    src: () => rowOf('Energy-Based'), target: () => $q('.space[title="공부"]'), hl: 'drop',
    apply: () => { S.tabs = S.tabs.filter((t) => t.id !== 22); },
  },
  // 일반 탭 → 다른 탭 가운데 = 분할 화면
  split: {
    src: () => rowOf('Helium'), target: () => rowOf('arc 대체'), hl: 'drop-split',
    apply: () => { tabById(23).splitViewId = 9; tabById(24).splitViewId = 9; },
  },
};

function drawCursor(pt, pressed) {
  const c = document.createElement('div');
  c.style.cssText = `position:fixed;left:${pt.x - 4}px;top:${pt.y - 3}px;z-index:9999;pointer-events:none;width:22px;height:22px;`;
  c.innerHTML = pressed
    ? '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="7" fill="rgba(0,0,0,.18)"/><path d="M4 2l14 10-6.2 1.2L15 20l-2.6 1.2-3.3-6.8L4 18z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l14 10-6.2 1.2L15 20l-2.6 1.2-3.3-6.8L4 18z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.append(c);
}

function drawGhost(srcEl, pt, grab) {
  const g = srcEl.cloneNode(true);
  const r = srcEl.getBoundingClientRect();
  g.classList.remove('dragging', 'active', 'drop', 'drop-split');
  g.style.cssText = `position:fixed;left:${pt.x - (grab.x - r.left)}px;top:${pt.y - (grab.y - r.top)}px;width:${Math.min(r.width, 230)}px;`
    + 'z-index:9998;pointer-events:none;opacity:.85;background:var(--card);box-shadow:0 6px 18px rgba(0,0,0,.18);border-radius:8px;transform:rotate(-1.5deg);list-style:none;';
  document.body.append(g);
}

function runAnim(name, f) {
  const cfg = ANIMS[name];
  if (!cfg) return;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  if (f >= RESULT) {
    // 놓기 직전 위치를 결과 화면에서도 커서로 보여 준다
    const before = cfg.point ? cfg.point() : centerOf(cfg.target());
    cfg.apply();
    render();
    drawCursor(before, false);
    return;
  }

  if (f >= 1) document.body.classList.add('dragging-tab');
  const src = cfg.src();
  const grab = grabOf(src);
  const dest = cfg.point ? cfg.point() : centerOf(cfg.target());
  const p = f <= 1 ? 0 : Math.min(1, (f - 1) / (LAST_MOVE - 1));
  const k = ease(p);
  const pt = { x: grab.x + (dest.x - grab.x) * k, y: grab.y + (dest.y - grab.y) * k };

  if (f >= 1) src.classList.add('dragging');
  if (f >= LAST_MOVE - 1) cfg.target()?.classList.add(cfg.hl);
  if (f >= 1) drawGhost(src, pt, grab);
  drawCursor(pt, f >= 1);
}
