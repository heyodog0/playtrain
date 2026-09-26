"""Point the human figure's vvvvvv curves at the WIN-bonus runs.

The corrected human scores include the +500 for reaching the goal, so the agent
curve on that game has to come from the bonus runs too -- comparing corrected
humans against pre-bonus agents would be the same scale mismatch in reverse.
Every other game is untouched.

usage: python swap_vv_curves.py <curves-in.json> <curves-out.json>
"""
import glob, json, os, sys
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

SRC, DST = sys.argv[1], sys.argv[2]
NEW = {"curves": ("impala", "outputs/_vvwin/i_vvvvvv_s%d"),
       "ppo_curves": ("ppo", "outputs/_vvwin/p_vvvvvv_s%d")}

d = json.load(open(SRC))
for key, (trainer, pat) in NEW.items():
    rows = []
    for s in range(3):
        run = pat % s
        tb = os.path.join(run, "tb")
        if not glob.glob(tb + "/events*"):
            print("MISSING", tb); continue
        acc = EventAccumulator(tb, size_guidance={"scalars": 0}); acc.Reload()
        tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
        evs = acc.Scalars(tags[0])
        step = [int(e.step) for e in evs]
        val = [float(e.value) for e in evs]
        wall = evs[-1].wall_time - evs[0].wall_time
        rows.append({"run": os.path.basename(run), "step": step, "value": val,
                     "sps": (step[-1] / wall) if wall > 0 else None})
        print("%-22s n=%4d last_step=%11d last=%8.1f sps=%s" % (
            os.path.basename(run), len(step), step[-1], val[-1],
            format(int(step[-1] / wall), ",") if wall > 0 else "-"))
    assert len(rows) == 3, "need 3 seeds"
    d[key]["vvvvvv"] = rows
    mk = "meta" if key == "curves" else "ppo_meta"
    d[mk]["vvvvvv"] = {"trainer": trainer, "net": "impala",
                       "runs": [r["run"] for r in rows], "win_bonus": 500}
json.dump(d, open(DST, "w"))
print("wrote", DST)
