"""Panel B of Figure 4: print the paper's ladder ratios beside both committed sets.

The paper's prose (main.tex L543) says QuickJS steps the games 13.4x faster than
Node/V8 and 117x faster than the browser. Those ratios are the tier3 QuickJS rung
over the *adv* Playwright and V8 rungs (job 43783367). The file the plotter reads,
backend_ladder_fasrc.json, still carries the pre-adv Playwright and V8 rungs, so
it gives 11.9x and 114x instead. Both sets are printed here rather than one being
quietly preferred; see reproduction/PROVENANCE.md and STATE.md flag 6.
"""
import json
import math
import statistics as st
from pathlib import Path

D = Path(__file__).resolve().parents[1] / "results" / "env_throughput"
PAPER_V8, PAPER_PW = 13.4, 117.0


def geo(xs):
    return math.exp(st.fmean(math.log(x) for x in xs))


def rungs(path):
    d = json.load(open(path))
    g = d["games"]
    return {k: geo([d[k][x] for x in g]) for k in ("playwright", "v8", "quickjs")}, len(g)


def main():
    plotted, n1 = rungs(D / "backend_ladder_fasrc.json")
    adv, n2 = rungs(D / "backend_ladder_adv" / "backend_ladder_fasrc_adv.json")
    qjs = plotted["quickjs"]          # tier3, job 44515373, in both readings

    print(f"    paper                      V8 -> QuickJS {PAPER_V8:5.1f}x   "
          f"browser -> QuickJS {PAPER_PW:5.0f}x")
    for lab, r, n in (("as plotted (pre-adv rungs)", plotted, n1),
                      ("adv rungs, job 43783367   ", adv, n2)):
        print(f"    {lab} V8 -> QuickJS {qjs / r['v8']:5.1f}x   "
              f"browser -> QuickJS {qjs / r['playwright']:5.0f}x"
              f"   (pw {r['playwright']:.0f}, v8 {r['v8']:.0f}, qjs {qjs:.0f}, {n} games)")

    ok = (abs(qjs / adv["v8"] - PAPER_V8) < 0.05
          and abs(qjs / adv["playwright"] - PAPER_PW) < 0.5)
    print(f"    the paper's pair is the adv one: {'yes' if ok else 'NO'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
