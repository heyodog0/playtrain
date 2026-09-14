#!/usr/bin/env python3
"""Generate the parity corpus: one action file per episode, plus a manifest.

Each policy plays against `cc_ref serve`, so its decisions are made from the
C's own state. What gets committed is only the resulting action bytes and the
manifest — replaying an action file needs no Python and no policy code, just
`cc_ref run <seed> <file>`, which is what the lockstep and golden gates do.

    ./build_corpus.py [--out DIR] [--max-steps N]

Action files are one byte per step in traces/corpus/. The manifest records,
per episode, the policy, seed, RNG seed, step count, terminal reason and the
achievements reached, so a later change to a policy shows up as a diff with
its consequences visible rather than as an opaque blob.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

from ccstate import ACH_NAMES, BLK_LAVA, MAX_TIMESTEPS, Layout, Serve
from policies import POLICIES

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE.parent / "traces"

# Offset so a policy's RNG stream does not coincide with the world seed.
RNG_OFFSET = 1000


def terminal_reason(state, done: bool) -> str:
    if not done:
        return "step-cap"
    if state.timestep >= MAX_TIMESTEPS:
        return "timeout"
    if state.block(state.player_r, state.player_c) == BLK_LAVA:
        return "lava"
    if state.health <= 0:
        return "health"
    return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--max-steps", type=int, default=MAX_TIMESTEPS)
    args = ap.parse_args()

    corpus_dir = args.out / "corpus"
    corpus_dir.mkdir(parents=True, exist_ok=True)

    layout = Layout.load()
    episodes = []
    for policy_name, (fn, n_episodes) in POLICIES.items():
        for seed in range(n_episodes):
            with Serve(seed, layout) as serve:
                actions = fn(serve, random.Random(RNG_OFFSET + seed), args.max_steps)
                state, done = serve.state, serve.done
            name = f"{policy_name}_{seed:03d}.bin"
            blob = bytes(actions)
            (corpus_dir / name).write_bytes(blob)
            episodes.append({
                "file": f"corpus/{name}",
                "policy": policy_name,
                "seed": seed,
                "rng_seed": RNG_OFFSET + seed,
                "steps": len(actions),
                "terminal": terminal_reason(state, done),
                "achievements": sorted(state.achievements_unlocked()),
                "sha256": hashlib.sha256(blob).hexdigest(),
            })
        print(f"{policy_name}: {n_episodes} episodes")

    reached = set()
    for ep in episodes:
        reached.update(ep["achievements"])
    manifest = {
        "state_bytes": layout.total,
        "max_steps": args.max_steps,
        "rng_offset": RNG_OFFSET,
        "policies": {k: v[1] for k, v in POLICIES.items()},
        "totals": {
            "episodes": len(episodes),
            "steps": sum(ep["steps"] for ep in episodes),
            "achievements_reached": sorted(reached),
            "achievements_missed": sorted(set(ACH_NAMES) - reached),
            "terminals": {
                reason: sum(1 for ep in episodes if ep["terminal"] == reason)
                for reason in sorted({ep["terminal"] for ep in episodes})
            },
        },
        "episodes": episodes,
    }
    (args.out / "corpus.json").write_text(json.dumps(manifest, indent=2) + "\n")
    t = manifest["totals"]
    print(f"{t['episodes']} episodes, {t['steps']} steps")
    print(f"achievements reached: {len(t['achievements_reached'])}/22")
    print(f"missed: {t['achievements_missed']}")
    print(f"terminals: {t['terminals']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
