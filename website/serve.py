#!/usr/bin/env python3
"""Static server for website/site with caching disabled.

Plain `python3 -m http.server` honours the browser cache, so an edited
stylesheet keeps rendering with the previous version until a hard reload. That
wastes a review cycle, so every response here is marked no-store.
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):        # keep the terminal quiet
        pass


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    directory = sys.argv[2] if len(sys.argv) > 2 else "website/site"
    handler = functools.partial(NoCacheHandler, directory=directory)
    print(f"\n  http://127.0.0.1:{port}/    (plain http, no caching)\n")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
