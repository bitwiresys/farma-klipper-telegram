import base64
import os
import socket
import ssl
import sys
from urllib.parse import urlparse


def _make_key() -> str:
    return base64.b64encode(os.urandom(16)).decode("ascii")


def probe(url: str, origin: str | None = None, timeout: float = 10.0) -> int:
    u = urlparse(url)
    if u.scheme not in ("ws", "wss"):
        raise SystemExit(f"Expected ws/wss URL, got: {u.scheme}")

    host = u.hostname
    if not host:
        raise SystemExit("URL missing hostname")

    port = u.port or (443 if u.scheme == "wss" else 80)
    path = u.path or "/"
    if u.query:
        path = f"{path}?{u.query}"

    sec_key = _make_key()

    req_lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {host}",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        f"Sec-WebSocket-Key: {sec_key}",
    ]
    if origin:
        req_lines.append(f"Origin: {origin}")

    req = ("\r\n".join(req_lines) + "\r\n\r\n").encode("utf-8")

    s = socket.create_connection((host, port), timeout=timeout)
    try:
        if u.scheme == "wss":
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(s, server_hostname=host)

        s.sendall(req)

        data = b""
        while b"\r\n\r\n" not in data and len(data) < 64 * 1024:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk

        head = data.split(b"\r\n\r\n", 1)[0].decode("iso-8859-1", errors="replace")
        lines = head.split("\r\n")
        status_line = lines[0] if lines else ""
        headers = {}
        for ln in lines[1:]:
            if ":" not in ln:
                continue
            k, v = ln.split(":", 1)
            headers[k.strip().lower()] = v.strip()

        print(status_line)
        for k in sorted(headers.keys()):
            print(f"{k}: {headers[k]}")

        if "location" in headers:
            print(f"\nRedirect location: {headers['location']}")

        # Return code if parsable
        try:
            code = int(status_line.split(" ", 2)[1])
        except Exception:
            code = 0
        return code
    finally:
        try:
            s.close()
        except Exception:
            pass


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python ws_handshake_probe.py <ws(s)://...> [origin]")
        raise SystemExit(2)

    url = sys.argv[1]
    origin = sys.argv[2] if len(sys.argv) >= 3 else None
    code = probe(url, origin=origin)
    raise SystemExit(0 if code else 1)


if __name__ == "__main__":
    main()
