# AGENTS.md

이 저장소에서 작업하는 에이전트(Claude Code, Codex 등)가 따르는 규칙.

## 작업 순서: 구현과 커밋·푸시는 분리

1. **구현**: 요청받은 변경만 로컬 파일에 반영한다.
2. **보고**: 무엇을 바꿨는지, 어떻게 확인했는지(또는 확인하지 못했는지) 알린다.
3. **멈춤**: 여기서 끝낸다. `git commit`, `git push`는 하지 않는다.
4. **커밋·푸시**: 사용자가 "커밋", "푸시", "올려줘"처럼 명시적으로 요청했을 때만 한다.
   - 한 번의 요청은 그 시점까지의 변경에만 해당한다. 다음 변경은 다시 요청을 받아야 한다.
   - 커밋 전에 `git status`로 포함될 파일을 확인하고 알린다.

GitHub Pages 설정, 저장소 설정 변경처럼 밖으로 공개되는 작업도 같은 규칙을 따른다.

## 아이콘 (주의)

- 저장소의 `icons/*.png`는 직접 그린 A 아이콘(흰 배경)이다.
- 로컬 작업 폴더에서는 Arc 로고로 덮어써서 쓰며, 이 파일들은 `git update-index --skip-worktree`로 무시하고 있다. Arc 로고는 상표라 공개 저장소에 올리지 않는다.
- 저장소용 아이콘을 바꿔야 할 때만 `--no-skip-worktree`로 풀고, 커밋 뒤 다시 `--skip-worktree`를 걸고 로컬 Arc 아이콘을 되돌린다.

## 문서 (`docs/`)

- `docs/index.html`이 GitHub Pages(main 브랜치 `/docs`)로 배포된다: https://eun0.github.io/Chrome_Extension_Arc_Space/
- 스크린샷: `zsh docs/capture/capture.sh`, 드래그 GIF: `zsh docs/capture/capture-gifs.sh`
  - 실제 `sidepanel.js`에 가짜 chrome API(`docs/capture/mock-chrome.js`)와 예시 탭 데이터를 넣어 헤드리스 크롬으로 찍는다. 실제 사용자 탭은 쓰지 않는다.
- UI를 바꾸면 관련 스크린샷·GIF도 다시 찍을지 사용자에게 확인한다.

## 코드 구조

- `background.js`: 스페이스 전환, 즐겨찾기, 자동 정리, 단축키 (service worker)
- `sidepanel.{html,css,js}`: 사이드패널 UI
- `media-hook.js`: 재생바용 Media Session 훅 (사용자가 허용한 사이트에만 주입)
- 용어: 맨 위 아이콘 = **공통 즐겨찾기**, 스페이스 이름 아래·가로선 위 = **스페이스 즐겨찾기**, 가로선 아래 = **일반 탭**
- 변경 후 최소 확인: `node --check background.js sidepanel.js`
