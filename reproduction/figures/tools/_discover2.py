"""All IMPALA-encoder runs per human-study game, with checkpoint + tb + steps."""
import glob
import json
import os

GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]
rows = {g: [] for g in GAMES}

for cj in glob.glob("outputs/*/config.json"):
    rd = os.path.dirname(cj)
    name = os.path.basename(rd)
    if "failed" in name or "partial" in name or "probe" in name:
        continue
    try:
        c = json.load(open(cj))
    except Exception:
        continue
    base = os.path.basename(str(c.get("game", ""))).replace(".js", "")
    if base not in rows or "." in base:
        continue
    enc = str(c.get("encoder") or c.get("net") or c.get("model") or "?")
    if enc != "impala":
        continue
    rows[base].append(dict(
        d=name, seed=c.get("seed", "?"),
        steps=c.get("total_steps") or c.get("steps") or "?",
        ckpt=os.path.exists(f"{rd}/final.pt"), tb=os.path.isdir(f"{rd}/tb")))

print("game            runs  usable  detail")
picks = {}
for g in GAMES:
    ok = [r for r in rows[g] if r["ckpt"] and r["tb"]]
    ok.sort(key=lambda r: (-(r["steps"] if isinstance(r["steps"], int) else 0), str(r["seed"])))
    picks[g] = [r["d"] for r in ok]
    det = ", ".join(f"{r['d']}(s{r['seed']},{r['steps']})" for r in ok[:4])
    print(f"{g:<15}{len(rows[g]):>4}{len(ok):>8}  {det}")

json.dump(picks, open("outputs/_human_game_runs.json", "w"), indent=1)
print("\nwrote outputs/_human_game_runs.json")
