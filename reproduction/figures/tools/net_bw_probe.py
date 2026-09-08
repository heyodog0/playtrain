"""Tiny TCP bandwidth probe between two cluster nodes (no deps).

Answers the Track B question raised by shim v3 plateauing at ~2.0 GB/s of
obs traffic (162k SPS x 12.3KB): is the default hostname route the slow
interface, and what does one TCP stream / several streams actually carry?

  server: python tools/net_bw_probe.py serve --port P
  client: python tools/net_bw_probe.py send --server host:P --gb 20 \
              --streams 1  (then try --streams 4)
"""
from __future__ import annotations

import argparse
import socket
import threading
import time

CHUNK = 4 * 1024 * 1024


def tune(s):
    s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    for opt in (socket.SO_RCVBUF, socket.SO_SNDBUF):
        try:
            s.setsockopt(socket.SOL_SOCKET, opt, 32 * 1024 * 1024)
        except OSError:
            pass


def serve(port: int, seconds: float) -> None:
    srv = socket.create_server(("0.0.0.0", port), backlog=16)
    srv.settimeout(1.0)
    stop = time.time() + seconds
    total = [0]
    lock = threading.Lock()

    def drain(conn):
        tune(conn)
        buf = bytearray(CHUNK)
        view = memoryview(buf)
        got = 0
        t0 = time.perf_counter()
        while True:
            n = conn.recv_into(view, CHUNK)
            if n == 0:
                break
            got += n
        dt = time.perf_counter() - t0
        with lock:
            total[0] += got
        print(f"conn done: {got/1e9:.1f} GB in {dt:.1f}s = "
              f"{got/dt/1e9:.2f} GB/s", flush=True)

    threads = []
    while time.time() < stop:
        try:
            conn, addr = srv.accept()
            print(f"accepted {addr}", flush=True)
            t = threading.Thread(target=drain, args=(conn,), daemon=True)
            t.start()
            threads.append(t)
        except socket.timeout:
            continue
    for t in threads:
        t.join(timeout=30)
    print(f"TOTAL received {total[0]/1e9:.1f} GB", flush=True)


def send(server: str, gb: float, streams: int) -> None:
    host, port = server.rsplit(":", 1)
    payload = bytes(CHUNK)
    per_stream = int(gb * 1e9 / streams)

    def one(i):
        s = socket.create_connection((host, int(port)))
        tune(s)
        sent = 0
        t0 = time.perf_counter()
        while sent < per_stream:
            s.sendall(payload)
            sent += CHUNK
        s.shutdown(socket.SHUT_WR)
        dt = time.perf_counter() - t0
        print(f"stream {i}: {sent/1e9:.1f} GB in {dt:.1f}s = "
              f"{sent/dt/1e9:.2f} GB/s", flush=True)

    t0 = time.perf_counter()
    ts = [threading.Thread(target=one, args=(i,)) for i in range(streams)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    dt = time.perf_counter() - t0
    print(f"AGGREGATE {streams} streams: {gb:.0f} GB in {dt:.1f}s = "
          f"{gb/dt:.2f} GB/s", flush=True)


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="mode", required=True)
    s1 = sub.add_parser("serve")
    s1.add_argument("--port", type=int, required=True)
    s1.add_argument("--seconds", type=float, default=240)
    s2 = sub.add_parser("send")
    s2.add_argument("--server", required=True)
    s2.add_argument("--gb", type=float, default=20)
    s2.add_argument("--streams", type=int, default=1)
    args = p.parse_args()
    if args.mode == "serve":
        serve(args.port, args.seconds)
    else:
        send(args.server, args.gb, args.streams)


if __name__ == "__main__":
    main()
