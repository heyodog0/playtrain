"""Guard: the human figure's curve file must have both arms on IMPALA-CNN.

The caption of fig:human_wallclock says "Both RL agents use the IMPALA-CNN
encoder". Each curve file's metadata records the encoder per arm, and this
script fails if the two arms differ or are not IMPALA-CNN.

    python check_curve_encoder.py rerun_curves_icnn.json
"""
import json
import sys


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "rerun_curves_icnn.json"
    d = json.load(open(path))
    arms = {"IMPALA": d["meta"], "PPO": d["ppo_meta"]}
    bad = []
    for arm, meta in arms.items():
        nets = sorted({v["net"] for v in meta.values()})
        print(f"    {arm:7s} arm: net={','.join(nets)}  ({len(meta)} games)")
        if nets != ["impala"]:
            bad.append(f"{arm} arm is net={','.join(nets)}, not impala")
    print(f"    caption claims both arms are IMPALA-CNN: {'yes' if not bad else 'NO'}")
    if bad:
        print("    " + "; ".join(bad), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
