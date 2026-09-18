"""Figure 4A: verify every plotted constant against the jobs that measured it.

Panel A is drawn from constants in plot_env_efficiency_bestonly.py (main()).
This recomputes each of them from committed data and refuses to pass if any
differs by more than 0.1%:

  PlayTrain, both suites, all seven thread counts
      geomean over games of the best trial, from
      figures/scaling/fig4a7_44545120/<game>_tier3_w<w>_r<n>.json   (job 44545120)
  EnvPool documented best, 10/20/30/40/60/80 threads
      the geomeans job 44601287 printed (runs/44601287/LOG.txt)
  EnvPool documented best, 5 threads
      the geomeans job 44614598 printed (runs/44614598/LOG.txt)

All three jobs ran on holy8a28510 (AMD Genoa, exclusive) on 2026-09-05, so the
two plotted arms are same-node. The as-shipped EnvPool series is not plotted and
not checked here; see PROVENANCE.md § fig:env_efficiency, panel A.

    uv run --no-project python tools/check_panel_a.py
"""
import glob
import json
import math
import re
import statistics as st
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIG = HERE.parent
RUNS = FIG.parent / "runs"
PG = "bigfish bossfight caveflyer chaser climber coinrun dodgeball fruitbot heist jumper leaper maze miner ninja plunder starpilot".split()
AL = "asteroids breakout freeway frostbite pong qbert seaquest space_invaders".split()
T = [5, 10, 20, 30, 40, 60, 80]
W = {5: 1, 10: 2, 20: 4, 30: 6, 40: 8, 60: 12, 80: 16}
TOL = 1e-3


def constants():
    src = (HERE / "plot_env_efficiency_bestonly.py").read_text()
    out = {}
    for name in ("pg_pt", "pg_epb", "al_pt", "al_epb"):
        m = re.search(rf"^\s*{name}\s*=\s*\[([^\]]*)\]", src, re.M)
        out[name] = [int(x) for x in m.group(1).replace(" ", "").split(",")]
    return out


def gm(xs):
    return math.exp(st.fmean(math.log(x) for x in xs))


def playtrain(games):
    d = FIG / "scaling" / "fig4a7_44545120"
    out = {}
    for t in T:
        vals = []
        for g in games:
            trials = [max(p["decisions_per_s"] for p in json.load(open(f)))
                      for f in glob.glob(str(d / f"{g}_tier3_w{W[t]}_r*.json"))]
            if not trials:
                return None, f"missing {g} w{W[t]}"
            vals.append(max(trials))
        out[t] = round(gm(vals))
    return out, None


def envpool(suite):
    out = {}
    for line in (RUNS / "44601287" / "LOG.txt").read_text().splitlines():
        m = re.match(rf"t(\d+)\s+{suite}\s+([\d,]+)", line)
        if m and int(m.group(1)) != 5:
            out[int(m.group(1))] = int(m.group(2).replace(",", ""))
    for line in (RUNS / "44614598" / "LOG.txt").read_text().splitlines():
        m = re.match(rf"t5 {suite}\s+single-pool\s+([\d,]+)", line)
        if m:
            out[5] = int(m.group(1).replace(",", ""))
    return out


def main():
    C = constants()
    bad = 0
    for suite, games, kpt, kep in (("procgen", PG, "pg_pt", "pg_epb"), ("ale", AL, "al_pt", "al_epb")):
        pt, err = playtrain(games)
        if err:
            print(f"    {suite}: {err}")
            return 2
        ep = envpool(suite)
        print(f"    {suite}, {len(games)} games")
        print(f"    {'t':>3} {'PlayTrain 44545120':>19} {'plotted':>10}   {'EnvPool best':>13} {'plotted':>10}   ratio")
        for i, t in enumerate(T):
            a, ca = pt[t], C[kpt][i]
            b, cb = ep.get(t), C[kep][i]
            oka = abs(a - ca) <= TOL * ca
            okb = b is not None and abs(b - cb) <= TOL * cb
            bad += (not oka) + (not okb)
            flag = "" if oka and okb else "   <-- MISMATCH"
            print(f"    {t:>3} {a:>19,} {ca:>10,}   {b if b is not None else 'n/a':>13,} {cb:>10,}   {ca / cb:5.2f}x{flag}")
    print(f"    all three jobs on holy8a28510, 2026-09-05; constants mismatched: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
