import json, glob, os
for f in sorted(glob.glob("outputs/pt_*_remote*.json")):
    try: d = json.load(open(f))
    except Exception: continue
    if isinstance(d, dict):
        keys = [k for k in ("sps","agent_sps","geomean_sps","mean_sps") if k in d]
        val = {k: d[k] for k in keys}
        extra = {k: d.get(k) for k in ("game","net","batch_size","vec_workers",
                                       "learner_gpus","nodes","fleet_workers") if k in d}
        print("%-38s %s  %s" % (os.path.basename(f), val, extra))
    else:
        print("%-38s (list, %d rows)" % (os.path.basename(f), len(d)))
