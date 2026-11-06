// 페이지(MAIN world)에 문서 시작 시점에 주입된다.
// 사이트가 navigator.mediaSession.setActionHandler 로 등록하는 "다음 곡/이전 곡/재생/일시정지" 동작을
// 가로채 기억해 두었다가, 사이드패널 재생바에서 그대로 호출한다. (키보드 미디어 키와 같은 경로)
(() => {
  if (window.__spacesMedia || !navigator.mediaSession) return;
  const handlers = {};
  const ms = navigator.mediaSession;
  const original = ms.setActionHandler.bind(ms);
  ms.setActionHandler = (action, handler) => {
    handlers[action] = handler;
    return original(action, handler);
  };
  window.__spacesMedia = (action) => {
    const h = handlers[action];
    if (typeof h !== 'function') return false;
    h({ action });
    return true;
  };
})();
