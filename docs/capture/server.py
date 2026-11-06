"""문서 캡처용 로컬 서버.

저장소 루트를 서빙하고, 사이드패널이 쓰는 /_favicon/?pageUrl=... 요청에는
사이트별 글자 아이콘(SVG)을 만들어 돌려준다. 네트워크 요청 없이 캡처하기 위함.

    python3 docs/capture/server.py 8765
"""
import http.server
import socketserver
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# host 일부 → (배경색, 글자색, 글자)
BRANDS = {
    'chatgpt': ('#10a37f', '#fff', 'G'),
    'claude': ('#d97757', '#fff', 'C'),
    'mail.google': ('#ea4335', '#fff', 'M'),
    'music.youtube': ('#ff0033', '#fff', '▶'),
    'youtube': ('#ff0033', '#fff', '▶'),
    'calendar.google': ('#1a73e8', '#fff', '31'),
    'notion': ('#191919', '#fff', 'N'),
    'figma': ('#a259ff', '#fff', 'F'),
    'linear': ('#5e6ad2', '#fff', 'L'),
    'jira': ('#0c66e4', '#fff', 'J'),
    'wiki': ('#1868db', '#fff', 'W'),
    'github': ('#1f2328', '#fff', 'GH'),
    'developer.chrome': ('#4285f4', '#fff', 'C'),
    'arxiv': ('#b31b1b', '#fff', 'X'),
    'google': ('#4285f4', '#fff', 'G'),
    'hada': ('#ff6600', '#fff', 'G'),
    'reddit': ('#ff4500', '#fff', 'R'),
    'instagram': ('#e1306c', '#fff', 'I'),
    'naver': ('#03c75a', '#fff', 'N'),
    'coupang': ('#e52528', '#fff', 'C'),
    'airbnb': ('#ff385c', '#fff', 'A'),
    'stackoverflow': ('#f48024', '#fff', 'S'),
    'musinsa': ('#000', '#fff', 'M'),
    'openreview': ('#8c1b13', '#fff', 'O'),
}


def favicon_svg(page_url: str) -> bytes:
    host = urllib.parse.urlparse(page_url).hostname or ''
    bg, fg, text = '#9ca3af', '#fff', (host[:1] or '?').upper()
    for key, val in BRANDS.items():
        if key in host:
            bg, fg, text = val
            break
    size = 15 if len(text) == 1 else 11
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
        f'<rect width="32" height="32" rx="7" fill="{bg}"/>'
        f'<text x="16" y="21.5" font-family="-apple-system,Helvetica,Arial" font-size="{size}" '
        f'font-weight="700" fill="{fg}" text-anchor="middle">{text}</text></svg>'
    )
    return svg.encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith('/_favicon/'):
            page = urllib.parse.parse_qs(parsed.query).get('pageUrl', [''])[0]
            body = favicon_svg(page)
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', port), Handler) as httpd:
        httpd.serve_forever()
