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
    default:
      break;
  }
}, 300);
