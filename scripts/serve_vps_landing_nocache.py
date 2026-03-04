#!/usr/bin/env python3
"""Serve vps-landing with no-cache headers for reliable local UI refreshes."""

from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:  # noqa: D401
        # Disable caching so billing UI updates are immediately visible.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve static files with no-cache headers.")
    parser.add_argument("--port", type=int, default=8090, help="Port to bind (default: 8090)")
    parser.add_argument("--dir", default=".", help="Directory root to serve")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.dir).resolve()
    if not root.exists() or not root.is_dir():
        print(f"[WisePlan] ERROR: Invalid static root: {root}")
        return 1

    handler = partial(NoCacheHandler, directory=str(root))
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print(f"[WisePlan] Serving {root} at http://localhost:{args.port} (no-cache)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
