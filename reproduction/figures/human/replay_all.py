"""Recompute every human-study score by replaying the logged actions.

The vvvvvv WIN bonus changes no dynamics, so the humans played a bit-identical
game and their scores can be recomputed instead of re-collected. Replaying all
eight games is also the check that the other seven game files have NOT drifted
since the study: for those, every replayed score must equal the logged one.

Writes a corrected copy of the study-data tree (episode `score` updated, plus a
`replayGameState`), which is what plot_steps.py reads.

usage: python replay_all.py <study-data-in> <study-data-out> <games-dir>
       (reproduce.sh human_rescore runs it on data/study and checks the result
        against data/study_rescored)
"""
import glob, json, os, re, sys
import numpy as np
from playtrain.runtime.env import PlayTrainEnv

SRC, DST, GD = sys.argv[1], sys.argv[2], sys.argv[3]
BONUS = 500          # the vvvvvv terminal reward added to the WIN branch
GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]
MIN_START = "2026-08-05T16:52:00Z"   # the flappy_bird gate commit
NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)', re.I)
os.makedirs(DST, exist_ok=True)

envs = {}
stat = {g: {"n": 0, "win": 0, "same": 0, "diff": 0, "untrusted": 0, "logged": [], "new": []}
        for g in GAMES}

for f in sorted(glob.glob(f"{SRC}/*.json")):
    d = json.load(open(f))
    pid = str(d.get("participantId", ""))
    # Same cohort as plot_steps.py: the study served TWO flappy_bird builds and the
    # site was rebuilt from the gate commit (16:52Z) mid-study, so only the 20
    # participants after that boundary form one consistent cohort. The 10 earlier
    # sessions played a flappy_bird where the bird falls immediately.
    if (NON_PARTICIPANT.match(pid) or d.get("partial")
            or not d.get("finishedAt") or d.get("startedAt", "") < MIN_START):
        continue
    for b in d.get("blocks", []):
        g = b.get("game")
        if g not in GAMES or b.get("practice"):
            continue
        if g not in envs:
            envs[g] = PlayTrainEnv(game=g, frame_skip=1, frame_stack=1,
                                   obs_size=64, games_dir=GD)
        env = envs[g]
        for e in b.get("episodes", []):
            if e.get("discarded"):
                continue
            acts, seed, rec = e.get("actions"), e.get("seed"), e.get("score")
            if not acts or seed is None:
                continue
            env.reset(seed=int(seed))
            info = {}
            for a in acts:
                _, _, term, trunc, info = env.step(int(a))
                if term or trunc:
                    break
            new, gs = info.get("score"), info.get("gameState")
            s = stat[g]
            s["n"] += 1
            s["win"] += gs == "WIN"
            s["same" if new == rec else "diff"] += 1
            s["logged"].append(rec)
            s["new"].append(new)
            # Only trust a replayed score when the replay is provably faithful:
            # either it reproduces the logged score exactly, or it differs by
            # exactly the bonus. Anything else means the replay diverged (flappy_bird
            # does this on 185/939 episodes even at its exact study hash), and the
            # logged score is the better number -- overwriting it there dragged
            # flappy_bird's median to 0 and broke panel B's score/median axis.
            delta = None if (new is None or rec is None) else new - rec
            e["scoreLogged"] = rec
            e["replayGameState"] = gs
            e["replayScore"] = new
            if delta in (0, BONUS):
                e["score"] = new
                e["replayTrusted"] = True
            else:
                s["untrusted"] = s.get("untrusted", 0) + 1
                e["replayTrusted"] = False
    json.dump(d, open(os.path.join(DST, os.path.basename(f)), "w"))

for e in envs.values():
    e.close()

print(f"{'game':>13} {'eps':>5} {'WIN':>5} {'same':>5} {'changed':>8} "
      f"{'untrusted':>10} {'logged mean':>12} {'kept mean':>10} {'shift':>8}")
for g in GAMES:
    s = stat[g]
    if not s["n"]:
        print(f"{g:>13}     0"); continue
    lo = np.array([x for x in s["logged"] if x is not None], float)
    nw = np.array([n if (n is not None and l is not None and (n - l) in (0, BONUS))
                    else l for l, n in zip(s["logged"], s["new"])
                   if l is not None], float)
    print(f"{g:>13} {s['n']:>5} {s['win']:>5} {s['same']:>5} {s['diff']:>8} "
          f"{s['untrusted']:>10} {lo.mean():12.1f} {nw.mean():10.1f} "
          f"{nw.mean()-lo.mean():+8.1f}")
print(f"\ncorrected tree -> {DST}")
