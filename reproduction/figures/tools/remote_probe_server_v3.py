"""Remote IMPALA server v3 — zero-copy ingest (Track B, beyond-node scale).

v1 (remote_probe_server.py) measured 32.3k SPS/shard, bound by the single
Python batcher doing parse + slot copies + unpinned H2D (~2ms of Python per
group-message). v3 restructures ingest around three ideas:

  1. **recv straight into the learner's buffer.** Slots store frames HWC
     (T+1, M, H, W, 3) pinned; the reader thread recv_into()'s the wire
     bytes directly into the slot row. No parse, no intermediate numpy, no
     CPU-side HWC->CHW transpose — the learner gets a channels-last view
     via a free GPU-side permute after H2D.
  2. **Readers own slot bookkeeping.** Row cursors, carry-row duplication,
     agent-field writes, and full/free queue traffic all live in the
     per-connection reader (safe: the per-group protocol is lockstep — the
     actor can't send row r+1 until the batcher replied to r, so
     last_agent is always settled before it's written). Backpressure is
     per-group (a reader blocking on free slots stalls only its group).
  3. **The batcher only moves and computes.** Pinned-H2D of just-written
     rows into a preallocated GPU staging batch, ONE forward, D2H into
     pinned output staging, per-group action replies. No allocation, no
     parsing, no slot writes on the critical path.

Feedforward-only (nature/impala) — LSTM state threading stays in v1.
Learner: real V-trace learn() (bf16 + compiled), warmed up BEFORE the
listener opens (v1's GIL-convoy lesson, job 34435885). Compile mode
defaults to max-autotune-no-cudagraphs: NatureCNN's 8x8s4 conv falls back
to extern cuDNN, which crashes cudagraph capture (job 34450737).

Same wire protocol and actor client as v1 (remote_probe_actor.py).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import logging
import queue
import socket
import threading
import time
import traceback
from pathlib import Path

import numpy as np
import torch
from torch import nn

from remote_probe_proto import ACK, HELLO, MAGIC, recv_exact, tune

from playtrain_trainers.impala.learn import learn
from playtrain_trainers.impala.net import ImpalaNet


class Slot:
    """Pinned rollout slot. Frames HWC so wire bytes land in place."""

    def __init__(self, T: int, m: int, obs: int, num_actions: int):
        def pinned(*size, dtype):
            return torch.empty(*size, dtype=dtype).pin_memory()
        self.t = {
            "frame": pinned(T + 1, m, obs, obs, 3, dtype=torch.uint8),
            "reward": pinned(T + 1, m, dtype=torch.float32),
            "done": pinned(T + 1, m, dtype=torch.bool),
            "episode_return": pinned(T + 1, m, dtype=torch.float32),
            "episode_step": pinned(T + 1, m, dtype=torch.int32),
            "policy_logits": pinned(T + 1, m, num_actions, dtype=torch.float32),
            "baseline": pinned(T + 1, m, dtype=torch.float32),
            "last_action": pinned(T + 1, m, dtype=torch.int64),
            "action": pinned(T + 1, m, dtype=torch.int64),
        }
        # numpy views for recv_into (share the pinned pages).
        self.frame_np = self.t["frame"].numpy()

    def copy_row(self, src: "Slot", src_r: int, dst_r: int) -> None:
        for k in self.t:
            self.t[k][dst_r].copy_(src.t[k][src_r])


class Group:
    def __init__(self, gid: int, sock: socket.socket, m: int,
                 num_actions: int):
        self.gid = gid
        self.sock = sock
        self.m = m
        self.row = 0
        self.slot: Slot | None = None
        self.msgs = 0
        self.last_logits = torch.zeros(m, num_actions)
        self.last_baseline = torch.zeros(m)
        self.last_action = torch.zeros(m, dtype=torch.int64)
        self.act_out = np.empty(m, dtype=np.int32)


class Server:
    def __init__(self, args):
        self.args = args
        self.device = torch.device("cuda")
        self.obs_shape = (3, args.obs, args.obs)
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

        def build(channels_last=False):
            model = ImpalaNet(self.obs_shape, args.num_actions,
                              features_dim=256, use_lstm=False,
                              channels_last=channels_last,
                              net=args.net).to(self.device)
            return model

        self.learner_model = build(channels_last=True).to(
            memory_format=torch.channels_last)
        if args.compile_mode != "off":
            self.learner_model.compile(mode=args.compile_mode)
        self.inference_model = build()
        self.inference_model.load_state_dict(self.learner_model.state_dict())
        self.inference_model.train()
        self.optimizer = torch.optim.RMSprop(
            self.learner_model.parameters(), lr=args.lr, momentum=0.0,
            eps=1e-5, alpha=0.99)

        T, m = args.unroll, args.group_size
        self.free: queue.SimpleQueue = queue.SimpleQueue()
        self.full: queue.SimpleQueue = queue.SimpleQueue()
        for _ in range(args.slots_per_group * args.max_groups):
            self.free.put(Slot(T, m, args.obs, args.num_actions))

        # GPU staging for the batched forward (NHWC uint8) + pinned outputs.
        max_b = args.max_groups * m
        self.stage_frame = torch.empty(max_b, args.obs, args.obs, 3,
                                       dtype=torch.uint8, device=self.device)
        self.stage_done = torch.zeros(1, max_b, dtype=torch.bool,
                                      device=self.device)
        self.stage_reward = torch.zeros(1, max_b, device=self.device)
        self.stage_last_action = torch.zeros(1, max_b, dtype=torch.int64,
                                             device=self.device)
        self.out_logits = torch.empty(max_b, args.num_actions).pin_memory()
        self.out_baseline = torch.empty(max_b).pin_memory()
        self.out_action = torch.empty(max_b, dtype=torch.int64).pin_memory()

        self.requests: queue.SimpleQueue = queue.SimpleQueue()
        self.groups: dict[int, Group] = {}
        self.stop = threading.Event()
        self.autocast = lambda: torch.autocast("cuda", torch.bfloat16)
        self.decisions = 0
        self.learn_steps = 0
        self.n_forwards = 0
        self.n_batched = 0
        self.learn_lock = threading.Lock()

    # ---- warmup (v1 lesson: compile BEFORE the listener opens) -------------
    def _warmup(self) -> None:
        T, m = self.args.unroll, self.args.group_size
        t0 = time.perf_counter()
        logging.info("warmup: compiling learner (%s)...",
                     self.args.compile_mode)
        snap = {k: v.detach().clone()
                for k, v in self.learner_model.state_dict().items()}
        slot = self.free.get()
        g = torch.Generator().manual_seed(0)
        slot.t["frame"].copy_(torch.randint(0, 256, slot.t["frame"].shape,
                                            dtype=torch.uint8, generator=g))
        slot.t["reward"].normal_(generator=g)
        slot.t["policy_logits"].normal_(generator=g)
        slot.t["action"].random_(0, self.args.num_actions, generator=g)
        batch = self._slot_to_batch(slot)
        for _ in range(3):
            with self.autocast():
                learn(actor_model=None, learner_model=self.learner_model,
                      batch=batch, initial_agent_state=(),
                      optimizer=self.optimizer, scheduler=None,
                      discounting=0.99, baseline_cost=0.5,
                      entropy_cost=self.args.entropy_cost,
                      grad_norm_clipping=40.0, reward_clipping="abs_one",
                      lock=self.learn_lock)
        self.free.put(slot)
        self.learner_model.load_state_dict(snap)
        self.optimizer = torch.optim.RMSprop(
            self.learner_model.parameters(), lr=self.args.lr, momentum=0.0,
            eps=1e-5, alpha=0.99)
        self.inference_model.load_state_dict(snap)
        with torch.no_grad(), self.autocast():
            self.inference_model(self._stage_inputs(4 * m), ())
        torch.cuda.synchronize()
        logging.info("warmup done in %.0fs", time.perf_counter() - t0)

    def _slot_to_batch(self, slot: Slot) -> dict:
        batch = {k: v.to(self.device, non_blocking=True)
                 for k, v in slot.t.items()}
        # HWC pinned layout -> (T+1, M, C, H, W) channels-last view. The
        # net's channels_last path recognizes the layout; no copy.
        batch["frame"] = batch["frame"].permute(0, 1, 4, 2, 3)
        return batch

    def _stage_inputs(self, b: int) -> dict:
        return {
            "frame": self.stage_frame[:b].permute(0, 3, 1, 2).unsqueeze(0),
            "reward": self.stage_reward[:, :b],
            "done": self.stage_done[:, :b],
            "last_action": self.stage_last_action[:, :b],
        }

    # ---- reader: one per connection; owns its group's slots ----------------
    def reader(self, sock: socket.socket, gid: int) -> None:
        try:
            hello = memoryview(bytearray(HELLO.size))
            recv_exact(sock, hello)
            magic, m, obs, _seed = HELLO.unpack(hello)
            assert magic == MAGIC and m == self.args.group_size \
                and obs == self.args.obs, "hello mismatch"
            sock.sendall(ACK.pack(self.args.num_actions))
            g = Group(gid, sock, m, self.args.num_actions)
            self.groups[gid] = g
            T = self.args.unroll
            small = memoryview(bytearray(13 * m))  # rew f32|done u8|ret f32|step i32
            logging.info("group %d connected (M=%d)", gid, m)

            while not self.stop.is_set():
                if g.slot is None:
                    g.slot = self.free.get()
                r = g.row
                t = g.slot.t
                recv_exact(sock, memoryview(g.slot.frame_np[r]).cast("B"))
                recv_exact(sock, small)
                sm = np.frombuffer(small, dtype=np.uint8)
                t["reward"][r].copy_(torch.from_numpy(
                    sm[:4 * m].view(np.float32).copy()))
                t["done"][r].copy_(torch.from_numpy(
                    sm[4 * m:5 * m].astype(bool)))
                t["episode_return"][r].copy_(torch.from_numpy(
                    sm[5 * m:9 * m].view(np.float32).copy()))
                t["episode_step"][r].copy_(torch.from_numpy(
                    sm[9 * m:13 * m].view(np.int32).copy()))
                t["policy_logits"][r].copy_(g.last_logits)
                t["baseline"][r].copy_(g.last_baseline)
                t["action"][r].copy_(g.last_action)
                t["last_action"][r].copy_(g.last_action)

                if r == T:
                    new_slot = self.free.get()
                    new_slot.copy_row(g.slot, T, 0)  # carry BEFORE handoff
                    self.full.put(g.slot)
                    g.slot = new_slot
                    g.row = 1
                    infer_row = 0  # the just-written frame now lives here
                else:
                    g.row += 1
                    infer_row = r
                g.msgs += 1
                self.decisions += m  # benign int race; stats only
                self.requests.put((g, g.slot, infer_row))
        except (ConnectionError, OSError):
            logging.info("group %d disconnected", gid)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            self.stop.set()

    # ---- batcher: H2D + one forward + replies -------------------------------
    def batcher(self) -> None:
        try:
            self._batcher_loop()
        except Exception:  # noqa: BLE001
            logging.exception("batcher crashed — stopping server")
            self.stop.set()

    def _batcher_loop(self) -> None:
        m = self.args.group_size
        while not self.stop.is_set():
            try:
                first = self.requests.get(timeout=0.5)
            except queue.Empty:
                continue
            pending = [first]
            deadline = time.monotonic() + self.args.batch_window_ms / 1000
            while len(pending) < len(self.groups):
                try:
                    pending.append(self.requests.get(
                        timeout=max(0.0, deadline - time.monotonic())))
                except queue.Empty:
                    break

            b = len(pending) * m
            for i, (g, slot, r) in enumerate(pending):
                sl = slice(i * m, (i + 1) * m)
                self.stage_frame[sl].copy_(slot.t["frame"][r],
                                           non_blocking=True)
                self.stage_done[0, sl].copy_(slot.t["done"][r],
                                             non_blocking=True)
                self.stage_last_action[0, sl].copy_(g.last_action,
                                                    non_blocking=True)
            with torch.no_grad(), self.autocast():
                out, _ = self.inference_model(self._stage_inputs(b), ())
            self.out_logits[:b].copy_(out["policy_logits"][0].float(),
                                      non_blocking=True)
            self.out_baseline[:b].copy_(out["baseline"][0].float(),
                                        non_blocking=True)
            self.out_action[:b].copy_(out["action"][0], non_blocking=True)
            torch.cuda.current_stream().synchronize()
            for i, (g, slot, r) in enumerate(pending):
                sl = slice(i * m, (i + 1) * m)
                g.last_logits.copy_(self.out_logits[sl])
                g.last_baseline.copy_(self.out_baseline[sl])
                g.last_action.copy_(self.out_action[sl])
                np.copyto(g.act_out, g.last_action.numpy().astype(np.int32))
                try:
                    g.sock.sendall(g.act_out.tobytes())
                except OSError:
                    pass
            self.n_forwards += 1
            self.n_batched += len(pending)

    # ---- learner -------------------------------------------------------------
    def learner(self, tid: int) -> None:
        del tid
        while not self.stop.is_set():
            slot = self.full.get()
            if slot is None:
                return
            batch = self._slot_to_batch(slot)
            torch.cuda.current_stream().synchronize()
            self.free.put(slot)
            with self.autocast():
                learn(actor_model=None, learner_model=self.learner_model,
                      batch=batch, initial_agent_state=(),
                      optimizer=self.optimizer, scheduler=None,
                      discounting=0.99, baseline_cost=0.5,
                      entropy_cost=self.args.entropy_cost,
                      grad_norm_clipping=40.0, reward_clipping="abs_one",
                      lock=self.learn_lock)
            self.learn_steps += 1
            if self.learn_steps % self.args.sync_every == 0:
                with self.learn_lock:
                    self.inference_model.load_state_dict(
                        self.learner_model.state_dict())

    # ---- main ----------------------------------------------------------------
    def run(self) -> dict:
        self._warmup()
        listener = socket.create_server(("0.0.0.0", self.args.port),
                                        backlog=64)
        listener.settimeout(1.0)
        threading.Thread(target=self.batcher, daemon=True).start()
        learners = [threading.Thread(target=self.learner, args=(i,),
                                     daemon=True)
                    for i in range(self.args.learner_threads)]
        for t in learners:
            t.start()
        logging.info("listening on :%d", self.args.port)

        conns, gid = [], 0
        t_start = time.perf_counter()
        last_log, d0 = t_start, 0
        while time.perf_counter() - t_start < self.args.seconds:
            with contextlib.suppress(socket.timeout):
                sock, _ = listener.accept()
                tune(sock)
                threading.Thread(target=self.reader, args=(sock, gid),
                                 daemon=True).start()
                conns.append(sock)
                gid += 1
            now = time.perf_counter()
            if now - last_log > 15:
                logging.info(
                    "SPS=%.0f learner_frames/s=%.0f groups=%d "
                    "avg_batch=%.0f full_q=%d",
                    (self.decisions - d0) / (now - last_log),
                    self.args.unroll * self.args.group_size
                    * self.learn_steps / (now - t_start),
                    len(self.groups),
                    self.n_batched / max(self.n_forwards, 1)
                    * self.args.group_size,
                    self.full.qsize())
                d0, last_log = self.decisions, now

        elapsed = time.perf_counter() - t_start
        self.stop.set()
        for s in conns:
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)
                s.close()
        listener.close()
        for _ in learners:
            self.full.put(None)
        for t in learners:
            t.join(timeout=10)
        result = {
            "sps_mean": round(self.decisions / elapsed),
            "learner_frames_per_s_mean": round(
                self.learn_steps * self.args.unroll * self.args.group_size
                / elapsed),
            "decisions": self.decisions,
            "learn_steps": self.learn_steps,
            "groups": len(self.groups),
            "seconds": round(elapsed, 1),
        }
        logging.info("RESULT %s", result)
        return result


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="[server-v3 %(asctime)s] %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--unroll", type=int, default=64)
    p.add_argument("--group-size", type=int, default=256)
    p.add_argument("--max-groups", type=int, default=16)
    p.add_argument("--slots-per-group", type=int, default=3)
    p.add_argument("--obs", type=int, default=64)
    p.add_argument("--num-actions", type=int, default=8)
    p.add_argument("--net", default="nature")
    p.add_argument("--compile-mode", default="max-autotune-no-cudagraphs")
    p.add_argument("--learner-threads", type=int, default=2)
    p.add_argument("--sync-every", type=int, default=10)
    p.add_argument("--lr", type=float, default=5e-4)
    p.add_argument("--entropy-cost", type=float, default=0.01)
    p.add_argument("--batch-window-ms", type=float, default=1.0)
    p.add_argument("--seconds", type=float, default=300.0)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    result = Server(args).run()
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
