"""fig:craftax_views, step 1: a scripted Craftax-Classic episode.

Steps craftax_classic (RGB) and craftax_fp (RGB, the first-person variant) in
lockstep with one action stream, chosen by a scripted policy that reads a third,
symbolic craftax_classic. Saves every 64x64 frame of both, and the action log.
The paper's figure is seed 2 (258 steps, day into night).

    uv run --no-sync python reproduction/figures/craftax/collect_frames.py OUT_DIR 2 300

Run from the repo root with the package installed. obs_size must stay 64.
"""
import sys, json, numpy as np
from playtrain.runtime.env import PlayTrainEnv
out, seed, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rng = np.random.default_rng(seed)
G = ("craftax_classic", "craftax_fp")
envs = {g: PlayTrainEnv(game=g, obs_size=64, obs_mode="rgb") for g in G}
sym = PlayTrainEnv(game="craftax_classic", obs_mode="symbolic")
frames = {g: [envs[g].reset(seed=seed)[0]] for g in G}
s = sym.reset(seed=seed)[0]
MOVE = {(0, -1): 1, (0, 1): 2, (-1, 0): 3, (1, 0): 4}
def parse(s):
    t = s[:1323].reshape(7, 9, 21); rest = s[1323:]
    inv = np.rint(rest[:12] * 10).astype(int); d = int(np.argmax(rest[16:20])) + 1
    return t, inv, d
log, wander = [], 3
for step in range(n):
    t, inv, d = parse(s)
    blk = t[:, :, :17].argmax(-1); zomb = t[:, :, 17]
    face = {1: (0, -1), 2: (0, 1), 3: (-1, 0), 4: (1, 0)}[d]
    fr, fc = 3 + face[0], 4 + face[1]
    ev = ""
    if zomb[fr, fc]: a, ev = 5, "attack"
    elif inv[0] >= 2 and not (blk == 11).any(): a, ev = 8, "table"
    elif (blk == 11).any() and inv[0] >= 1 and inv[6] == 0: a, ev = 11, "pickaxe"
    elif blk[fr, fc] == 5: a, ev = 5, "chop"
    else:
        trees = np.argwhere(blk == 5)
        if len(trees):
            dr, dc = min(trees, key=lambda p: abs(p[0]-3)+abs(p[1]-4)) - np.array([3, 4])
            if abs(dr) + abs(dc) == 1: a = MOVE[(int(dr), int(dc))]  # turn to face (blocked, so no step)
            elif abs(dc) > 0 and blk[3, 4+int(np.sign(dc))] in (2, 7, 13): a = MOVE[(0, int(np.sign(dc)))]
            elif abs(dr) > 0: a = MOVE[(int(np.sign(dr)), 0)]
            else: a = MOVE[(0, int(np.sign(dc)))]
            ev = "seek"
        else:
            if rng.random() < 0.1: wander = int(rng.integers(1, 5))
            a, ev = wander, "wander"
    done = False
    for g in G:
        o, r, term, trunc, info = envs[g].step(a); frames[g].append(o); done |= term or trunc
    s, _, term, trunc, _ = sym.step(a)
    log.append(dict(t=step+1, a=int(a), ev=ev, wood=int(inv[0]), light=float(s[1343])))
    if done or term or trunc: print("episode ended at", step+1); break
for g in G: np.save(f"{out}/{g}_scripted_s{seed}.npy", np.stack(frames[g])); envs[g].close()
sym.close(); json.dump(log, open(f"{out}/log_s{seed}.json", "w"))
evs = {}
for l in log: evs.setdefault(l["ev"], []).append(l["t"])
print({k: (len(v), v[:3]) for k, v in evs.items()}, "final wood", log[-1]["wood"], "min light", min(l["light"] for l in log))
