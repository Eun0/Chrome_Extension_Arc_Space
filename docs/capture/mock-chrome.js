// 문서용 스크린샷을 찍기 위한 가짜 chrome.* API.
// 실제 sidepanel.js 를 그대로 띄우고, 탭·스페이스 데이터만 예시 값으로 채운다.
(() => {
  const scene = new URLSearchParams(location.search).get('scene') || 'overview';
  const HOUR = 3600 * 1000;
  const now = Date.now();

  const favorites = [
    { id: 'f1', url: 'https://chatgpt.com/', title: 'ChatGPT' },
    { id: 'f2', url: 'https://claude.ai/', title: 'Claude', tabId: 2 },
    { id: 'f3', url: 'https://mail.google.com/', title: 'Gmail' },
    { id: 'f4', url: 'https://music.youtube.com/', title: 'YouTube Music', tabId: 1 },
    { id: 'f5', url: 'https://calendar.google.com/', title: 'Calendar' },
    { id: 'f6', url: 'https://www.notion.so/', title: 'Notion' },
    { id: 'f7', url: 'https://www.figma.com/', title: 'Figma' },
    { id: 'f8', url: 'https://linear.app/', title: 'Linear', icon: { type: 'tile', text: 'L', bg: '#8b5cf6', fg: '#ffffff' } },
  ];

  const spaces = [
    {
      id: 'work', name: '업무', icon: '', color: '#5b7cfa', tabs: [],
      pins: [
        { id: 'p1', url: 'https://jira.example.com/board', title: 'Sprint 보드', tabId: 10 },
        { id: 'p2', url: 'https://wiki.example.com/team', title: '팀 위키' },
        { id: 'p3', url: 'https://github.com/example/app/pulls', title: 'Pull requests', tabId: 11 },
      ],
    },
    {
      id: 'home', name: '개인', icon: '🏠', color: '#30a46c', tabs: [],
      pins: [
        { id: 'p4', url: 'https://www.instagram.com/', title: 'Instagram', tabId: 30 },
        { id: 'p5', url: 'https://map.naver.com/', title: '네이버 지도' },
      ],
    },
    { id: 'study', name: '공부', icon: '📚', color: '#f08c2e', tabs: [], pins: [] },
  ];

  const T = (id, index, url, title, extra = {}) => ({
    id, index, windowId: 1, url, title, active: false, pinned: false, audible: false,
    mutedInfo: { muted: false }, splitViewId: -1, lastAccessed: now - HOUR, ...extra,
  });

  const workTabs = [
    T(1, 0, 'https://music.youtube.com/watch?v=x', '소란한 밤이 있었어 | YouTube Music', { pinned: true, audible: true }),
    T(2, 1, 'https://claude.ai/', 'Claude', { pinned: true }),
    T(10, 2, 'https://jira.example.com/board', 'Sprint 보드'),
    T(11, 3, 'https://github.com/example/app/pulls', 'Pull requests · example/app'),
    T(20, 4, 'https://github.com/example/app/pull/412', 'Fix: 세션 만료 시 재로그인 처리 #412', { active: true }),
    T(21, 5, 'https://developer.chrome.com/docs/extensions/reference/api/tabs', 'chrome.tabs | Chrome for Developers'),
    T(22, 6, 'https://arxiv.org/abs/2410.00001', 'Energy-Based Policy Optimization'),
    T(23, 7, 'https://www.google.com/search?q=arc', 'arc 대체 브라우저 - Google 검색'),
    T(24, 8, 'https://news.hada.io/topic?id=1', 'Helium 브라우저 | GeekNews'),
    T(25, 9, 'https://www.reddit.com/r/ArcBrowser/', '지금까지 나온 아크 브라우저 대안 정리'),
  ];
  if (scene === 'split') {
    workTabs.splice(5, 2,
      T(21, 5, 'https://developer.chrome.com/docs/extensions/reference/api/tabs', 'chrome.tabs | Chrome for Developers', { splitViewId: 7 }),
      T(26, 6, 'https://github.com/example/app/blob/main/sidepanel.js', 'sidepanel.js · example/app', { splitViewId: 7 }),
    );
  }
  const homeTabs = [
    T(1, 0, 'https://music.youtube.com/watch?v=x', '소란한 밤이 있었어 | YouTube Music', { pinned: true, audible: true }),
    T(2, 1, 'https://claude.ai/', 'Claude', { pinned: true }),
    T(30, 2, 'https://www.instagram.com/', 'Instagram'),
    T(31, 3, 'https://www.youtube.com/watch?v=y', '주말 캠핑 브이로그 - YouTube', { active: true }),
    T(32, 4, 'https://www.coupang.com/', '쿠팡 - 장바구니'),
    T(33, 5, 'https://www.airbnb.co.kr/', '제주 숙소 - Airbnb'),
  ];

  const archive = [
    { id: 'a1', url: 'https://stackoverflow.com/q/1', title: 'How to discard a tab before it loads?', spaceId: 'work', spaceName: '업무', closedAt: now - 2 * HOUR },
    { id: 'a2', url: 'https://www.google.com/search?q=split+view', title: 'chrome split view api - Google 검색', spaceId: 'work', spaceName: '업무', closedAt: now - 3 * HOUR },
    { id: 'a3', url: 'https://www.youtube.com/watch?v=z', title: '10분 만에 이해하는 Diffusion', spaceId: 'study', spaceName: '공부', closedAt: now - 5 * HOUR },
    { id: 'a4', url: 'https://github.com/example/lib/issues/88', title: 'Memory leak when reconnecting · Issue #88', spaceId: 'work', spaceName: '업무', closedAt: now - 26 * HOUR },
    { id: 'a5', url: 'https://www.musinsa.com/', title: '무신사 - 겨울 아우터', spaceId: 'home', spaceName: '개인', closedAt: now - 27 * HOUR },
    { id: 'a6', url: 'https://openreview.net/forum?id=abc', title: 'OpenReview: Scaling Test-Time Compute', spaceId: 'study', spaceName: '공부', closedAt: now - 30 * HOUR },
  ];

  const activeSpaceId = scene === 'space2' ? 'home' : 'work';
  const tabs = activeSpaceId === 'home' ? homeTabs : workTabs;
  const local = { favorites, spaces, activeSpaceId, archive, settings: { archiveHours: 24 } };
  const ev = () => ({ addListener() {}, removeListener() {} });
  const clone = (x) => JSON.parse(JSON.stringify(x));

  window.__mockScene = scene;
  window.chrome = {
    runtime: {
      getURL: (p) => location.origin + p,
      sendMessage: () => Promise.resolve({ ok: true }),
      connect: () => ({ onDisconnect: ev() }),
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    storage: {
      local: { get: async (defaults) => ({ ...defaults, ...clone(local) }) },
      session: { get: async () => ({ lazy: {} }) },
      onChanged: ev(),
    },
    tabs: {
      SPLIT_VIEW_ID_NONE: -1,
      query: async () => clone(tabs),
      update: async () => {}, remove: async () => {}, move: async () => {}, create: async () => {},
      duplicate: async () => {}, createSplit: async () => 1, unsplit: async () => {},
      onCreated: ev(), onUpdated: ev(), onRemoved: ev(), onMoved: ev(), onActivated: ev(),
      onAttached: ev(), onDetached: ev(), onReplaced: ev(),
    },
    permissions: { request: async () => true },
    commands: {
      getAll: async () => [
        { name: 'toggle-panel', shortcut: '⌘B' },
        { name: 'prev-space', shortcut: '⌥⇧←' },
        { name: 'next-space', shortcut: '⌥⇧→' },
      ],
    },
    scripting: { executeScript: async () => [{ result: 'session' }] },
  };
})();
