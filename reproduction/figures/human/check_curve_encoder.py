"""Guard: the human figure's curve file must have both arms on IMPALA-CNN.

The caption of fig:human_wallclock says "Both RL agents use the IMPALA-CNN
encoder". Three curve files sit here and their metadata records the encoder per
arm:

    rerun_curves.json        IMPALA net=impala, PPO net=nature   <- MIXED
    rerun_curves_nature.json both net=nature
    rerun_curves_icnn.json   both net=impala                     <- the caption's

Drawing the mixed file compares an IMPALA-CNN IMPALA against a Nature-CNN PPO,
which is the hazard that has already bitten the suite panels twice. This script
fails loudly rather than letting a plausible-looking figure through.

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
