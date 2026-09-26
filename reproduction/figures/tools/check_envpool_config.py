"""tab:envpool-config: the tuned EnvPool configuration, row by row, against the job.

Every row is a line in the as-run submission committed at
reproduction/runs/43779854/ep_best_sweep.sbatch (job 43779854, the documented-
best EnvPool arm of fig:env_efficiency panel A). This asserts each row's
evidence is present rather than paraphrasing it.

    python tools/check_envpool_config.py
"""
from __future__ import annotations

from pathlib import Path

SBATCH = (Path(__file__).resolve().parents[1] / ".." / "runs" / "43779854"
          / "ep_best_sweep.sbatch").resolve()

# (paper row, paper value, the substring that proves it)
ROWS = [
    ("API", "make_gymnasium, async_reset and send/recv",
     ["envpool.make_gymnasium(", "env.async_reset()", "env.recv()", "env.send("]),
    ("pools per node", "one per NUMA domain, each in its own process",
     ['glob.glob("/sys/devices/system/node/node[0-9]*")', "subprocess.Popen"]),
    ("envs per pool", "total / domains (2,048 envs at 80 threads)",
     ["envs = 2048 * T // 80"]),
    ("threads per pool", "total / domains", ["pe, pt = envs // K, max(1, T // K)"]),
    ("batch size", "max(16, 3 x threads per pool)", ["BS = max(16, pt * 3)"]),
    ("thread affinity", "offset to that domain's first CPU",
     ["thread_affinity_offset=off", "str(i * CPD)"]),
    ("ALE spec", "64x64 RGB, stack_num=1, frame_skip=1",
     ["img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1"]),
    ("ProcGen spec", "defaults, already 64x64 RGB",
     ['if env_id.endswith("-v5")']),
    ("actions", "uniform random, sampled per batch",
     ["np.random.randint(0, na, size=len(ids))"]),
]
PROSE = [("4 s warmup then a 12 s measured window", ["pump(4.0); n, dt = pump(12.0)"]),
         ("summed across pools, then geometric mean",
          ["tot += json.loads", "def geo(v): return math.exp"])]


def main():
    src = SBATCH.read_text()
    print(f"    checking {SBATCH.name} ({len(src.splitlines())} lines)")
    bad = []
    for row, value, proofs in ROWS:
        missing = [p for p in proofs if p not in src]
        ok = not missing
        if not ok:
            bad.append(f"{row}: not evidenced -- missing {missing}")
        print(f"      {'ok ' if ok else 'NO '} {row:<18} {value}")
    print("    prose around the table:")
    for claim, proofs in PROSE:
        missing = [p for p in proofs if p not in src]
        if missing:
            bad.append(f"{claim}: missing {missing}")
        print(f"      {'ok ' if not missing else 'NO '} {claim}")
    print(f"    rows without evidence: {len(bad)}")
    for b in bad:
        print(f"      {b}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
