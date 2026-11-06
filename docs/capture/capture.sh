#!/bin/zsh
# 문서용 스크린샷 다시 찍기 (macOS, Google Chrome 필요)
#   zsh docs/capture/capture.sh
set -e
cd "$(dirname "$0")/../.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8765
OUT=docs/images
PROFILE=$(mktemp -d)

python3 docs/capture/server.py $PORT &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$PROFILE"' EXIT
sleep 1

shot() {  # 이름 장면 높이 [추가 플래그]
  local name=$1 scene=$2 height=$3; shift 3
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$PROFILE" --force-device-scale-factor=2 \
    --window-size=600,$height --virtual-time-budget=3000 "$@" \
    --screenshot="$PWD/$OUT/$name.png" \
    "http://127.0.0.1:$PORT/docs/capture/panel.html?scene=$scene" >/dev/null 2>&1
  python3 -c "from PIL import Image; im=Image.open('$OUT/$name.png'); im.crop((0,0,680,im.height)).save('$OUT/$name.png')"
  echo "  $OUT/$name.png"
}

shot overview      overview      760
shot overview-dark overview      760 --force-dark-mode
shot space2        space2        760
shot player        player        760
shot drag          drag          760
shot split         split         760
shot menu          menu          760
shot pin-menu      pin-menu      760
shot archive       archive       760
shot settings      settings      760
shot space-editor  space-editor  760
shot icon-editor   icon-editor   760
