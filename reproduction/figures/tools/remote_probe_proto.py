"""Wire protocol for the remote-actor IMPALA probe (SEED-style split).

One persistent TCP connection per env GROUP (a ping-pong half of a worker's
PingPongVecEnv). After a fixed-size hello, every message has a FIXED size
derived from (M, obs) — no per-message framing, no serialization library:

  hello  (actor->server):  <IIII  magic, M, obs_px, base_seed
  ack    (server->actor):  <I     num_actions
  step   (actor->server):  obs  M*obs*obs*3 u8   (HWC, post-step frame)
                           reward M f32
                           done   M u8
                           ep_ret M f32          (act_vec bookkeeping semantics)
                           ep_step M i32
  act    (server->actor):  M i32

The first step message after hello carries the RESET frame with reward=0,
done=1 (Environment.initial() convention). last_action never crosses the
wire — the server already knows it (it chose it).
"""
from __future__ import annotations

import socket
import struct

MAGIC = 0x504C5452  # "PLTR"
HELLO = struct.Struct("<IIII")
ACK = struct.Struct("<I")


def step_msg_size(m: int, obs: int) -> int:
    return m * (obs * obs * 3 + 4 + 1 + 4 + 4)


def recv_exact(sock: socket.socket, view: memoryview) -> None:
    """Fill `view` completely from the socket (recv_into: no Python-level
    byte copies). Raises ConnectionError on EOF — the clean-shutdown signal."""
    got, n = 0, len(view)
    while got < n:
        r = sock.recv_into(view[got:], n - got)
        if r == 0:
            raise ConnectionError("peer closed")
        got += r


def tune(sock: socket.socket) -> None:
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    for opt in (socket.SO_RCVBUF, socket.SO_SNDBUF):
        try:
            sock.setsockopt(socket.SOL_SOCKET, opt, 8 * 1024 * 1024)
        except OSError:
            pass
