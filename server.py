import http.server
import socketserver
import urllib.parse
import os
import json
import time
import threading
import shutil

PORT = 8080
LOG_FILE = "browser_logs.txt"
STORE_FILE = os.path.join("data", "store.json")

_store_lock = threading.Lock()
_store_version = str(time.time())
_last_client_id = None


def _read_store():
    if os.path.exists(STORE_FILE):
        try:
            with open(STORE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _write_store(data, client_id=None):
    global _store_version, _last_client_id
    tmp = STORE_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    shutil.move(tmp, STORE_FILE)
    _store_version = str(time.time())
    _last_client_id = client_id


class MyHandler(http.server.SimpleHTTPRequestHandler):

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self._send_cors_headers()
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == '/api/store':
            with _store_lock:
                data = _read_store()
            body = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif parsed.path == '/api/store/version':
            res_obj = {"version": _store_version, "lastClientId": _last_client_id}
            body = json.dumps(res_obj).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif parsed.path == '/log':
            query = urllib.parse.parse_qs(parsed.query)
            msg = query.get('msg', [''])[0]
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(msg + '\n')
            self.send_response(200)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'OK')

        else:
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == '/api/store':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode('utf-8'))
                client_id = payload.get('clientId')
                with _store_lock:
                    data = _read_store()
                    data[payload['key']] = payload['value']
                    _write_store(data, client_id)
                res_body = json.dumps({
                    "ok": True,
                    "version": _store_version,
                    "lastClientId": _last_client_id
                }).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(res_body)))
                self.end_headers()
                self.wfile.write(res_body)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # アクセスログを非表示


# 起動時の準備
os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs('data', exist_ok=True)

# store.json が存在しない場合は空で作成
if not os.path.exists(STORE_FILE):
    with open(STORE_FILE, 'w', encoding='utf-8') as f:
        json.dump({}, f)

print(f"Summon Balancer サーバー起動 → http://localhost:{PORT}")

# 複数クライアント同時接続対応
with socketserver.ThreadingTCPServer(("", PORT), MyHandler) as httpd:
    httpd.serve_forever()
