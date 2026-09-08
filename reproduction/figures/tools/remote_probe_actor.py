"""CPU-node actor for the remote IMPALA probe — torch-free by design.

Each worker process owns one PingPongVecEnv (2 groups x M envs on a shared
C++ threadpool) and 2 TCP connections (one per group). Per group step:

    wait(g) -> build step msg -> sendall -> recv actions -> send(g, actions)

The two groups alternate, so the network round-trip + server-side GPU
inference for one group hides behind the other group's C++ env stepping —
the same latency-hiding structure act_vec_db uses locally, with the
shared-memory flag channel swapped for a socket.

Episode bookkeeping (ep_return / ep_step report the COMPLETED episode on
done rows, then reset) mirrors vec_actor's Half.absorb exactly, so the
server can write learner slots byte-compatible with local vec mode.

Exits cleanly when the server closes the connection (probe over) or after
--seconds as a fallback.
"""
from __future__ import annotations

import argparse
import logging
import multiprocessing as mp
import socket
import time
import traceback

import numpy as np

from remote_probe_proto import ACK, HELLO, MAGIC, recv_exact, step_msg_size, tune


def _connect(server: str, retries: int = 300) -> socket.socket:
    # Generous window: the server compiles its learner BEFORE opening the
    # listener (~2-5 min for max-autotune), so early actors must keep trying.
    host, port = server.rsplit(":", 1)
    for i in range(retries):
        try:
            s = socket.create_connection((host, int(port)), timeout=10)
            s.settimeout(None)
            tune(s)
            return s
        except OSError:
            time.sleep(2.0)
    raise ConnectionError(f"could not reach {server} after {retries} tries")


class Group:
    """One ping-pong half: its socket, bookkeeping, and message buffers."""

    def __init__(self, g: int, m: int, obs: int, server: str, base_seed: int):
        self.g = g
        self.m = m
        self.obs = obs
        self.sock = _connect(server)
        self.sock.sendall(HELLO.pack(MAGIC, m, obs, base_seed))
        ack = memoryview(bytearray(ACK.size))
        recv_exact(self.sock, ack)
        (self.num_actions,) = ACK.unpack(ack)
        self.ep_return = np.zeros(m, dtype=np.float32)
        self.ep_step = np.zeros(m, dtype=np.int32)
        self.msg = bytearray(13 * m)  # small-fields tail (obs goes zero-copy)
        self.act_buf = memoryview(bytearray(4 * m))
        self.sent = 0

    def send_step(self, obs_hwc: np.ndarray, rew: np.ndarray,
                  done: np.ndarray) -> None:
        m = self.m
        self.ep_step += 1
        self.ep_return += rew
        ep_ret_out = self.ep_return.copy()
        ep_step_out = self.ep_step.copy()
        if done.any():
            idx = np.nonzero(done)[0]
            self.ep_return[idx] = 0.0
            self.ep_step[idx] = 0
        # Zero-copy obs send: the 3.1MB tobytes() assembly was the per-worker
        # pace-setter (~28k SPS/worker measured, shards probe 34574273) —
        # send the array's memoryview directly, then one small tail buffer.
        self.sock.sendall(memoryview(obs_hwc).cast("B"))
        tail = self.msg  # reused 13*m-byte tail buffer
        tail[:4 * m] = rew.astype(np.float32).tobytes()
        tail[4 * m:5 * m] = done.astype(np.uint8).tobytes()
        tail[5 * m:9 * m] = ep_ret_out.tobytes()
        tail[9 * m:13 * m] = ep_step_out.tobytes()
        self.sock.sendall(tail)
        self.sent += 1

    def send_initial(self, obs_hwc: np.ndarray) -> None:
        """Environment.initial() convention: reward 0, done all-True, counters
        zero — WITHOUT ticking the bookkeeping."""
        m = self.m
        self.sock.sendall(memoryview(obs_hwc).cast("B"))
        tail = self.msg
        tail[:4 * m] = np.zeros(m, np.float32).tobytes()
        tail[4 * m:5 * m] = np.ones(m, np.uint8).tobytes()
        tail[5 * m:9 * m] = np.zeros(m, np.float32).tobytes()
        tail[9 * m:13 * m] = np.zeros(m, np.int32).tobytes()
        self.sock.sendall(tail)
        self.sent += 1

    def recv_actions(self) -> np.ndarray:
        recv_exact(self.sock, self.act_buf)
        return np.frombuffer(self.act_buf, dtype=np.int32)


def worker(idx: int, args) -> None:
    logging.basicConfig(level=logging.INFO,
                        format=f"[actor-{idx} %(asctime)s] %(message)s")
    try:
        from playtrain.runtime.native_vec_env import PingPongVecEnv
        m = args.group_size
        env = PingPongVecEnv(
            args.game, group_size=m, obs_size=args.obs,
            max_steps=args.max_steps, num_threads=args.env_threads,
            frame_skip=args.frame_skip, render_skip=True,
        )
        base = args.base_seed + idx * 10_000
        obs_all = env.reset(seeds=(base + np.arange(2 * m)).astype(np.int32))
        groups = [Group(g, m, args.obs, args.server, base + g)
                  for g in range(2)]
        logging.info("connected (2 groups x %d envs, %d env threads)",
                     m, args.env_threads)

        # Prime the ping-pong: initial obs -> server -> first actions -> send.
        for h in groups:
            h.send_initial(np.ascontiguousarray(obs_all[h.g * m:(h.g + 1) * m]))
            env.send(h.g, h.recv_actions())

        t0 = time.perf_counter()
        last_log = t0
        while time.perf_counter() - t0 < args.seconds:
            for h in groups:
                obs, rew, term, trunc = env.wait(h.g)
                h.send_step(np.ascontiguousarray(obs), rew, term | trunc)
                env.send(h.g, h.recv_actions())
            now = time.perf_counter()
            if now - last_log > 20:
                rate = sum(h.sent for h in groups) * m / (now - t0)
                logging.info("%.0f env-steps/s (this worker)", rate)
                last_log = now
        env.close()
        logging.info("done (%d group-steps)", sum(h.sent for h in groups))
    except ConnectionError as e:
        logging.info("server closed (%s) — exiting cleanly", e)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        raise


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--server", required=True, help="host:port")
    p.add_argument("--game", required=True)
    p.add_argument("--workers", type=int, default=6)
    p.add_argument("--env-threads", type=int, default=7)
    p.add_argument("--group-size", type=int, default=64)
    p.add_argument("--obs", type=int, default=64)
    p.add_argument("--frame-skip", type=int, default=7)
    p.add_argument("--max-steps", type=int, default=35000)
    p.add_argument("--base-seed", type=int, default=0)
    p.add_argument("--seconds", type=float, default=300.0)
    args = p.parse_args()

    procs = [mp.Process(target=worker, args=(i, args), daemon=False)
             for i in range(args.workers)]
    for pr in procs:
        pr.start()
    for pr in procs:
        pr.join()


if __name__ == "__main__":
    main()
