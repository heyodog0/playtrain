"""Curves + measured sps from the rerun sweep (outputs/_rerun/rr_*)."""
import glob, json, os, statistics as st, sys
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator as EA
GAMES = ["asteroids","vvvvvv","breakout","flappy_bird","seaquest","coinrun","caveflyer","plunder"]
out = {"curves": {}, "ppo_curves": {}, "meta": {}, "ppo_meta": {}}
for tr, ck, mk in (("impala","curves","meta"), ("ppo","ppo_curves","ppo_meta")):
    for g in GAMES:
        rows = []
        for d in sorted(glob.glob(f"outputs/_rerun/rr_{tr}_{g}_s*")):
            if not os.path.exists(d + "/final.pt"):
                continue
            a = EA(d + "/tb", size_guidance={"scalars": 0}); a.Reload()
            t = a.Tags()["scalars"]
            r = [x for x in t if "ep_return_mean" in x]
            if not r: continue
            ev = a.Scalars(r[0])
            sps = [e.value for e in a.Scalars("charts/sps") if e.value > 0] if "charts/sps" in t else []
            rows.append(dict(run=os.path.basename(d), step=[e.step for e in ev],
                             value=[e.value for e in ev],
                             sps=st.median(sps[len(sps)//2:]) if sps else None))
        if rows:
            out[ck][g] = rows
            cfg = json.load(open(f"outputs/_rerun/{rows[0]['run']}/config.json"))
            out[mk][g] = dict(trainer=tr, net=cfg.get("net"), runs=[r["run"] for r in rows])
json.dump(out, open(sys.argv[1], "w"))
print(f"{'game':<13}{'IMP n':>6}{'IMP end':>9}{'IMP sps':>10}{'PPO n':>6}{'PPO end':>9}{'PPO sps':>10}")
for g in GAMES:
    i, p = out["curves"].get(g, []), out["ppo_curves"].get(g, [])
    f = lambda rs: (len(rs), st.mean(r["value"][-1] for r in rs) if rs else 0,
                    st.median([r["sps"] for r in rs if r["sps"]]) if rs and any(r["sps"] for r in rs) else 0)
    ni, ei, si = f(i); npo, ep, sp = f(p)
    print(f"{g:<13}{ni:>6}{ei:>9.1f}{si:>10,.0f}{npo:>6}{ep:>9.1f}{sp:>10,.0f}")
