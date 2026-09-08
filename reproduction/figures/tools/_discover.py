"""List candidate suite runs per game: encoder, steps, checkpoint, tb."""
import glob
import json
import os

GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]

rows = {g: [] for g in GAMES}
for cj in glob.glob("outputs/*/config.json"):
    rd = os.path.dirname(cj)
    try:
        c = json.load(open(cj))
    except Exception:
        continue
    game = str(c.get("game", "") or c.get("env", "") or "")
    base = os.path.basename(game).replace(".js", "")
    if base not in rows:
        continue
    # variant runs (breakout.multi etc) are not the base game
    if "." in base:
        continue
    rows[base].append(dict(
        dir=os.path.basename(rd),
        enc=str(c.get("encoder") or c.get("net") or c.get("model") or "?"),
        steps=c.get("total_steps") or c.get("steps") or c.get("num_steps") or "?",
        seed=c.get("seed", "?"),
        ckpt=os.path.exists(os.path.join(rd, "final.pt")),
        tb=os.path.isdir(os.path.join(rd, "tb")),
    ))

for g in GAMES:
    v = [r for r in rows[g] if r["ckpt"] and r["tb"]]
    print(f"\n=== {g}: {len(rows[g])} runs, {len(v)} with final.pt+tb")
    for r in sorted(v, key=lambda r: str(r["steps"]), reverse=True)[:6]:
        print(f"   {r['dir']:<26} enc={r['enc']:<12} steps={str(r['steps']):<12} seed={r['seed']}")
