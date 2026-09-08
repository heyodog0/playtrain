"""GPU-node server for the remote IMPALA probe: batched inference + rollout
assembly + the REAL V-trace learner, end to end.

SEED-style split: remote CPU actors (remote_probe_actor.py) own only envs;
this server owns the policy. Per incoming step message it writes the rollout
row (act_vec slot/alignment contract, byte-compatible with local vec mode),
runs ONE batched GPU forward across all groups with pending requests, and
sends each group its actions. Completed (T+1, M) slots feed learner threads
running playtrain_trainers.impala.learn (bf16 + compiled), with periodic
learner->inference weight sync. No weights ever cross the network.

Slot-write rule per message (derived from vec_actor.act_vec; row 0 = carry
row whose agent fields learn() trims away):

    write row r = (env_output, last_agent);  r==0 -> snapshot LSTM state
    r==T -> push slot, pull fresh slot, rewrite row 0 with same values,
            snapshot state, r=1;  else r+=1
    infer on this frame (done-masked state) -> send actions -> last_agent

Reports end-to-end SPS (env decisions/s) and learner frames/s. Expectation
on ONE GPU: inference+learner contend (the known co-location tax), so
~100-150k SPS validates the transport; the production layout gives the
learner its own GPU.
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

from remote_probe_proto import ACK, HELLO, MAGIC, recv_exact, step_msg_size, tune

from playtrain_trainers.impala.learn import learn
from playtrain_trainers.impala.net import ImpalaNet


class Slot:
    def __init__(self, T: int, m: int, obs_shape, num_actions: int,
                 state_template):
        def pinned(*size, dtype):
            return torch.empty(*size, dtype=dtype).pin_memory()
        self.t = {
            "frame": pinned(T + 1, m, *obs_shape, dtype=torch.uint8),
            "reward": pinned(T + 1, m, dtype=torch.float32),
            "done": pinned(T + 1, m, dtype=torch.bool),
            "episode_return": pinned(T + 1, m, dtype=torch.float32),
            "episode_step": pinned(T + 1, m, dtype=torch.int32),
            "policy_logits": pinned(T + 1, m, num_actions, dtype=torch.float32),
            "baseline": pinned(T + 1, m, dtype=torch.float32),
            "last_action": pinned(T + 1, m, dtype=torch.int64),
            "action": pinned(T + 1, m, dtype=torch.int64),
        }
        self.state = tuple(torch.zeros_like(s).pin_memory()
                           for s in state_template)


class Group:
    """Server-side state for one remote env group. Mutated ONLY by the
    batcher thread (single-writer — no locks)."""

    def __init__(self, gid: int, sock: socket.socket, m: int,
                 num_actions: int, model, device):
        self.gid = gid
        self.sock = sock
        self.m = m
        self.row = 0
        self.slot: Slot | None = None
        self.msgs = 0
        self.last_logits = torch.zeros(m, num_actions)
        self.last_baseline = torch.zeros(m)
        self.last_action = torch.zeros(m, dtype=torch.int64)
        self.core_state = tuple(t.to(device)
                                for t in model.initial_state(batch_size=m))


class Server:
    def __init__(self, args):
        self.args = args
        self.device = torch.device("cuda")
        self.obs_shape = (3, args.obs, args.obs)
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True

        self.learner_model = ImpalaNet(
            self.obs_shape, args.num_actions, features_dim=256,
            use_lstm=not args.no_lstm, channels_last=True).to(self.device)
        self.learner_model = self.learner_model.to(
            memory_format=torch.channels_last)
        if args.compile_mode != "off":
            self.learner_model.compile(mode=args.compile_mode)
        self.inference_model = ImpalaNet(
            self.obs_shape, args.num_actions, features_dim=256,
            use_lstm=not args.no_lstm).to(self.device)
        self.inference_model.load_state_dict(self.learner_model.state_dict())
        self.inference_model.train()  # multinomial sampling
        self.optimizer = torch.optim.RMSprop(
            self.learner_model.parameters(), lr=args.lr, momentum=0.0,
            eps=1e-5, alpha=0.99)

        self.state_template = self.inference_model.initial_state(
            batch_size=args.group_size)
        n_slots = args.slots_per_group * args.max_groups
        self.free: queue.SimpleQueue = queue.SimpleQueue()
        self.full: queue.SimpleQueue = queue.SimpleQueue()
        for _ in range(n_slots):
            self.free.put(Slot(args.unroll, args.group_size, self.obs_shape,
                               args.num_actions, self.state_template))
        self.requests: queue.SimpleQueue = queue.SimpleQueue()
        self.groups: dict[int, Group] = {}
        self.stop = threading.Event()
        self.autocast = lambda: torch.autocast("cuda", torch.bfloat16)
        # Stats.
        self.decisions = 0
        self.learn_steps = 0
        self.n_forwards = 0
        self.n_batched = 0
        self.t_start = None
        self.first_learn_done = threading.Event()
        self.learn_lock = threading.Lock()

    # ---- reader: one thread per connection --------------------------------
    def reader(self, sock: socket.socket, gid: int) -> None:
        try:
            hello = memoryview(bytearray(HELLO.size))
            recv_exact(sock, hello)
            magic, m, obs, _seed = HELLO.unpack(hello)
            assert magic == MAGIC and m == self.args.group_size \
                and obs == self.args.obs, "hello mismatch"
            sock.sendall(ACK.pack(self.args.num_actions))
            group = Group(gid, sock, m, self.args.num_actions,
                          self.inference_model, self.device)
            self.groups[gid] = group
            msg_size = step_msg_size(m, obs)
            logging.info("group %d connected (M=%d)", gid, m)
            while not self.stop.is_set():
                arr = np.empty(msg_size, dtype=np.uint8)
                recv_exact(sock, memoryview(arr))
                self.requests.put((group, arr))
        except (ConnectionError, OSError):
            logging.info("group %d disconnected", gid)
        except Exception:  # noqa: BLE001
            traceback.print_exc()

    # ---- batcher: slot writes + batched inference (single thread) ---------
    def _parse(self, group: Group, arr: np.ndarray):
        m, o = group.m, self.args.obs
        n0 = m * o * o * 3
        frame = torch.from_numpy(arr[:n0].reshape(m, o, o, 3)) \
            .permute(0, 3, 1, 2)  # (M, C, H, W) view; slot write copies
        f32 = lambda a, k: torch.from_numpy(a[k[0]:k[1]].view(np.float32).copy())
        reward = f32(arr, (n0, n0 + 4 * m))
        done = torch.from_numpy(
            arr[n0 + 4 * m:n0 + 5 * m].astype(bool))
        ep_ret = f32(arr, (n0 + 5 * m, n0 + 9 * m))
        ep_step = torch.from_numpy(
            arr[n0 + 9 * m:n0 + 13 * m].view(np.int32).copy())
        return frame, reward, done, ep_ret, ep_step

    def _write_row(self, g: Group, r: int, frame, reward, done, ep_ret,
                   ep_step) -> None:
        t = g.slot.t
        t["frame"][r].copy_(frame)
        t["reward"][r].copy_(reward)
        t["done"][r].copy_(done)
        t["episode_return"][r].copy_(ep_ret)
        t["episode_step"][r].copy_(ep_step)
        t["policy_logits"][r].copy_(g.last_logits)
        t["baseline"][r].copy_(g.last_baseline)
        t["action"][r].copy_(g.last_action)
        t["last_action"][r].copy_(g.last_action)

    def _snapshot_state(self, g: Group) -> None:
        for dst, src in zip(g.slot.state, g.core_state):
            dst.copy_(src.detach().cpu())

    def batcher(self) -> None:
        try:
            self._batcher_loop()
        except Exception:  # noqa: BLE001 — a dead batcher must not hang silently
            logging.exception("batcher crashed — stopping server")
            self.stop.set()

    def _batcher_loop(self) -> None:
        T = self.args.unroll
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

            frames = []
            for g, arr in pending:
                frame, reward, done, ep_ret, ep_step = self._parse(g, arr)
                if g.slot is None:
                    g.slot = self.free.get()
                self._write_row(g, g.row, frame, reward, done, ep_ret, ep_step)
                if g.row == 0:
                    self._snapshot_state(g)
                if g.row == T:
                    self.full.put(g.slot)
                    g.slot = self.free.get()
                    self._write_row(g, 0, frame, reward, done, ep_ret, ep_step)
                    self._snapshot_state(g)
                    g.row = 1
                else:
                    g.row += 1
                g.msgs += 1
                self.decisions += g.m
                frames.append((g, frame, reward, done))

            # One batched forward for every pending group.
            B = sum(g.m for g, *_ in frames)
            inp = {
                "frame": torch.cat([f for _, f, _, _ in frames]) \
                    .unsqueeze(0).to(self.device, non_blocking=True),
                "reward": torch.cat([r for *_, r, _ in frames]) \
                    .unsqueeze(0).to(self.device, non_blocking=True),
                "done": torch.cat([d for *_, d in frames]) \
                    .unsqueeze(0).to(self.device, non_blocking=True),
                "last_action": torch.cat(
                    [g.last_action for g, *_ in frames]) \
                    .unsqueeze(0).to(self.device, non_blocking=True),
            }
            state = tuple(
                torch.cat([g.core_state[i] for g, *_ in frames], dim=1)
                for i in range(len(self.state_template)))
            with torch.no_grad(), self.autocast():
                out, new_state = self.inference_model(inp, state)
            logits = out["policy_logits"].float().cpu()[0]
            baseline = out["baseline"].float().cpu()[0]
            actions = out["action"].cpu()[0]
            off = 0
            for g, *_ in frames:
                sl = slice(off, off + g.m)
                g.last_logits.copy_(logits[sl])
                g.last_baseline.copy_(baseline[sl])
                g.last_action.copy_(actions[sl])
                if new_state:
                    for i, s in enumerate(g.core_state):
                        s.copy_(new_state[i][:, sl])
                try:
                    g.sock.sendall(
                        actions[sl].to(torch.int32).numpy().tobytes())
                except OSError:
                    pass
                off += g.m
            self.n_forwards += 1
            self.n_batched += len(frames)

    # ---- learner threads ---------------------------------------------------
    def learner(self, tid: int) -> None:
        if tid != 0:
            self.first_learn_done.wait()  # compile/warmup runs alone
        T, m = self.args.unroll, self.args.group_size
        while not self.stop.is_set():
            slot = self.full.get()
            if slot is None:
                return
            batch = {k: v.to(self.device, non_blocking=True)
                     for k, v in slot.t.items()}
            init_state = tuple(s.to(self.device, non_blocking=True)
                               for s in slot.state)
            torch.cuda.current_stream().synchronize()
            self.free.put(slot)
            with self.autocast():
                learn(actor_model=None, learner_model=self.learner_model,
                      batch=batch, initial_agent_state=init_state,
                      optimizer=self.optimizer, scheduler=None,
                      discounting=0.99, baseline_cost=0.5,
                      entropy_cost=self.args.entropy_cost,
                      grad_norm_clipping=40.0, reward_clipping="abs_one",
                      lock=self.learn_lock)
            self.learn_steps += 1
            if self.learn_steps == 1:
                self.first_learn_done.set()
                logging.info("first learn step done (compile finished)")
            if self.learn_steps % self.args.sync_every == 0:
                with self.learn_lock:
                    self.inference_model.load_state_dict(
                        self.learner_model.state_dict())

    def _warmup(self) -> None:
        """Compile the learner + warm the inference forward BEFORE the
        listener opens. Doing it after actors connect starves the dynamo
        trace behind 12 reader threads' GIL traffic — job 34435885 sat 28
        min in symbolic_convert with the main thread's stats loop never
        scheduled (classic GIL convoy). Weights/optimizer are restored
        after, so warmup gradient steps don't leak into training."""
        T, m = self.args.unroll, self.args.group_size
        t0 = time.perf_counter()
        logging.info("warmup: compiling learner on a synthetic batch "
                     "(%s, ~minutes)...", self.args.compile_mode)
        snap = {k: v.detach().clone()
                for k, v in self.learner_model.state_dict().items()}
        g = torch.Generator().manual_seed(0)
        synth = {
            "frame": torch.randint(0, 256, (T + 1, m, *self.obs_shape),
                                   dtype=torch.uint8, generator=g),
            "reward": torch.randn(T + 1, m, generator=g),
            "done": torch.rand(T + 1, m, generator=g) < 2e-4,
            "episode_return": torch.randn(T + 1, m, generator=g),
            "episode_step": torch.randint(0, 1000, (T + 1, m),
                                          dtype=torch.int32, generator=g),
            "policy_logits": torch.randn(T + 1, m, self.args.num_actions,
                                         generator=g),
            "baseline": torch.randn(T + 1, m, generator=g),
            "last_action": torch.zeros(T + 1, m, dtype=torch.int64),
            "action": torch.randint(0, self.args.num_actions, (T + 1, m),
                                    dtype=torch.int64, generator=g),
        }
        batch = {k: v.to(self.device) for k, v in synth.items()}
        init_state = tuple(t.to(self.device) for t in self.state_template)
        for _ in range(3):
            with self.autocast():
                learn(actor_model=None, learner_model=self.learner_model,
                      batch=batch, initial_agent_state=init_state,
                      optimizer=self.optimizer, scheduler=None,
                      discounting=0.99, baseline_cost=0.5,
                      entropy_cost=self.args.entropy_cost,
                      grad_norm_clipping=40.0, reward_clipping="abs_one",
                      lock=self.learn_lock)
        # Restore pre-warmup weights; fresh optimizer state. load_state_dict
        # copies in place, so the compiled graph stays valid.
        self.learner_model.load_state_dict(snap)
        self.optimizer = torch.optim.RMSprop(
            self.learner_model.parameters(), lr=self.args.lr, momentum=0.0,
            eps=1e-5, alpha=0.99)
        self.inference_model.load_state_dict(snap)
        # Warm the inference forward (cuDNN algo selection) at a plausible
        # batched shape.
        inp = {
            "frame": torch.zeros(1, 4 * m, *self.obs_shape,
                                 dtype=torch.uint8, device=self.device),
            "reward": torch.zeros(1, 4 * m, device=self.device),
            "done": torch.zeros(1, 4 * m, dtype=torch.bool,
                                device=self.device),
            "last_action": torch.zeros(1, 4 * m, dtype=torch.int64,
                                       device=self.device),
        }
        state = tuple(
            torch.cat([t.to(self.device)] * 4, dim=1)
            for t in self.state_template)
        with torch.no_grad(), self.autocast():
            self.inference_model(inp, state)
        torch.cuda.synchronize()
        self.first_learn_done.set()  # compile already done — don't stage
        logging.info("warmup done in %.0fs", time.perf_counter() - t0)

    # ---- main --------------------------------------------------------------
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
        self.t_start = time.perf_counter()
        last_log, d0, l0 = self.t_start, 0, 0
        while time.perf_counter() - self.t_start < self.args.seconds:
            with contextlib.suppress(socket.timeout):
                sock, addr = listener.accept()
                tune(sock)
                threading.Thread(target=self.reader, args=(sock, gid),
                                 daemon=True).start()
                conns.append(sock)
                gid += 1
            now = time.perf_counter()
            if now - last_log > 15:
                sps = (self.decisions - d0) / (now - last_log)
                lps = (self.learn_steps - l0) * self.args.unroll \
                    * self.args.group_size / (now - last_log)
                logging.info(
                    "SPS=%.0f learner_frames/s=%.0f groups=%d "
                    "avg_infer_batch=%.1f full_q=%d",
                    sps, lps, len(self.groups),
                    self.n_batched / max(self.n_forwards, 1) *
                    self.args.group_size,
                    self.full.qsize())
                d0, l0, last_log = self.decisions, self.learn_steps, now

        elapsed = time.perf_counter() - self.t_start
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
        # Steady-state SPS: recompute over the last logged window is noisy;
        # report whole-run mean and let the log show the ramp.
        result = {
            "sps_mean": round(self.decisions / elapsed),
            "learner_frames_per_s_mean": round(
                self.learn_steps * self.args.unroll * self.args.group_size
                / elapsed),
            "decisions": self.decisions,
            "learn_steps": self.learn_steps,
            "groups": len(self.groups),
            "avg_infer_batch_envs": round(
                self.n_batched / max(self.n_forwards, 1)
                * self.args.group_size, 1),
            "seconds": round(elapsed, 1),
        }
        logging.info("RESULT %s", result)
        return result


def main() -> None:
    logging.basicConfig(level=logging.INFO,
                        format="[server %(asctime)s] %(message)s")
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--unroll", type=int, default=200)
    p.add_argument("--group-size", type=int, default=64)
    p.add_argument("--max-groups", type=int, default=16)
    p.add_argument("--slots-per-group", type=int, default=2)
    p.add_argument("--obs", type=int, default=64)
    p.add_argument("--num-actions", type=int, default=8)
    p.add_argument("--no-lstm", action="store_true")
    p.add_argument("--compile-mode", default="max-autotune")
    p.add_argument("--learner-threads", type=int, default=2)
    p.add_argument("--sync-every", type=int, default=10)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--entropy-cost", type=float, default=0.004)
    p.add_argument("--batch-window-ms", type=float, default=2.0)
    p.add_argument("--seconds", type=float, default=240.0)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    result = Server(args).run()
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
