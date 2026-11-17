#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拾页 · 本地代理服务器（可选）

作用有两个：
1. 把本目录当作静态站点提供出来（http://127.0.0.1:8765）
2. 提供 POST /api/chat，把请求转发给 DeepSeek，绕开浏览器的跨域限制

用法：
    python server.py
    # 也可以先设置环境变量，前端就不用再填 Key 了：
    set DEEPSEEK_API_KEY=sk-xxxx  &&  python server.py

只依赖 Python 标准库，不需要安装任何东西。
"""

import json
import os
import socket
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
UPSTREAM_BASE = os.environ.get("DSE_BASE", "https://api.deepseek.com/v1").rstrip("/")
UPSTREAM = UPSTREAM_BASE + "/chat/completions"
PORT = int(os.environ.get("PORT", "8765"))
TIMEOUT = int(os.environ.get("DSE_TIMEOUT", "240"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---- 日志简洁一点 ----
    def log_message(self, fmt, *args):
        sys.stdout.write("  " + (fmt % args) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        # 页面部署在 https 站点（如 GitHub Pages）时，Chrome 会先发一个
        # "私有网络访问"预检，必须显式允许，否则本地代理会被拦。
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        if path != "/api/chat":
            self._json(404, {"error": {"message": "接口不存在"}})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length else b"{}"

        auth = self.headers.get("Authorization", "").strip()
        env_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
        if not auth and env_key:
            auth = "Bearer " + env_key
        if not auth:
            self._json(401, {"error": {"message": "缺少 API Key：在页面设置里填，或设置环境变量 DEEPSEEK_API_KEY"}})
            return

        # 允许前端覆盖上游地址（例如换到别家兼容接口）
        target = UPSTREAM
        override = self.headers.get("X-Upstream-Url", "").strip()
        if override.startswith("http://") or override.startswith("https://"):
            target = override

        req = urllib.request.Request(
            target,
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": auth,
                "Accept": "application/json",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            body = e.read()
            status = e.code
        except Exception as e:  # 网络层错误
            self._json(502, {"error": {"message": "转发失败：%s" % e}})
            return

        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def port_in_use(port):
    """Windows 上 http.server 默认的 SO_REUSEADDR 会让「端口已被占用」变成静默成功，
    所以启动前先主动探测一次。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def enable_utf8_console():
    """Windows 控制台默认是 GBK，中文提示会变乱码。切一下代码页。"""
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:
            pass
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def main():
    enable_utf8_console()

    if port_in_use(PORT):
        print("")
        print("  端口 %d 已经被占用了（可能已经开着一个 server.py）。" % PORT)
        print("  换一个端口再试：")
        print("      set PORT=8799 && python server.py")
        print("  然后把页面设置里的「代理地址」改成 http://127.0.0.1:8799")
        print("")
        return

    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print("")
        print("  端口 %d 起不来：%s" % (PORT, e))
        print("  换一个端口再试：set PORT=8799 && python server.py")
        print("")
        return

    url = "http://127.0.0.1:%d/" % PORT
    print("")
    print("  拾页 · 本地服务已启动")
    print("  页面地址 : " + url)
    print("  上游接口 : " + UPSTREAM)
    print("  Key 来源 : " + ("环境变量 DEEPSEEK_API_KEY" if os.environ.get("DEEPSEEK_API_KEY") else "页面设置里填写"))
    print("")
    print("  按 Ctrl+C 停止")
    print("")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
