#!/bin/zsh
# 드래그 동작 GIF 만들기 (macOS, Google Chrome + Python Pillow 필요)
#   zsh docs/capture/capture-gifs.sh            # 전부
#   zsh docs/capture/capture-gifs.sh pin split  # 일부만
set -e
cd "$(dirname "$0")/../.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8766
OUT=docs/images
PROFILE=$(mktemp -d)
FRAMES=$(mktemp -d)
NAMES=("$@"); (( $#NAMES )) || NAMES=(pin fav unpin move split)

python3 docs/capture/server.py $PORT &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$PROFILE" "$FRAMES"' EXIT
sleep 1

for name in $NAMES; do
  for f in $(seq 0 15); do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
      --user-data-dir="$PROFILE" --force-device-scale-factor=2 \
      --window-size=600,760 --virtual-time-budget=3000 \
      --screenshot="$FRAMES/$name-$(printf %02d $f).png" \
      "http://127.0.0.1:$PORT/docs/capture/panel.html?scene=anim-$name&f=$f" >/dev/null 2>&1
  done
  python3 - "$FRAMES" "$name" "$OUT/drag-$name.gif" <<'PY'
import sys
from pathlib import Path
from PIL import Image
frames_dir, name, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
paths = sorted(frames_dir.glob(f'{name}-*.png'))
frames = []
for p in paths:
    im = Image.open(p).convert('RGB')
    im = im.crop((0, 0, 680, im.height)).resize((340, im.height // 2), Image.LANCZOS)
    frames.append(im)
# 프레임별 시간(ms): 시작 정지, 누르기, 이동, 대상 위, 결과 정지
dur = [700, 220] + [55] * 12 + [600, 2000]
pal = frames[-1].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in frames]
q[0].save(out, save_all=True, append_images=q[1:], duration=dur[:len(q)], loop=0, optimize=True, disposal=1)
print(f'  {out}  ({Path(out).stat().st_size // 1024} KB)')
PY
done
