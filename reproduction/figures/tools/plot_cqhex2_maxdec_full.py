"""cqhex2 max_decisions sweep (episode wander-timeout / path-length ceiling) on
the fixed-env best recipe. max_decisions{250,500,1000,2000} + 5000 baseline (the
running cqhex2_fixed42). Does a tighter horizon give denser terminal feedback ->
faster/steadier learning, or does too-tight make the win unreachable? Panel 1:
GREEDY win-rate; panel 2: stochastic. Colored by max_decisions. Panel 3: final
(last-10%) greedy+stochastic vs max_decisions. Saves outputs/figs/cqhex2_maxdec_full.png."""
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
STEPS_M, GRID = 150, 1000
# max_decisions -> (group, name-filter)
SRC = {250:("cqhex2_maxdec","_md250_"), 500:("cqhex2_maxdec","_md500_"),
       1000:("cqhex2_maxdec","_md1000_"), 2000:("cqhex2_maxdec","_md2000_"),
       3000:("cqhex2_maxdec2","_md3000_"), 4000:("cqhex2_maxdec2","_md4000_"),
       5000:("cqhex2_fixed42","_fixed42_"), 6000:("cqhex2_maxdec2","_md6000_")}
MDS = sorted(SRC)
cmap = cm.get_cmap("viridis")
COL = {md: cmap(i/(len(MDS)-1)) for i, md in enumerate(MDS)}
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def pull(group, filt, key, smooth):
    xg = np.linspace(0, STEPS_M, GRID); out = []
    for r in api.runs(ENT, filters={"group": group, "state": "finished"}):
        if filt not in r.name: continue
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"]/h["_step"].max()*STEPS_M).to_numpy()
        y = h[key].to_numpy()
        out.append(np.interp(xg, x, ema(y) if smooth and len(y)>5 else y))
    return xg, out

fig, ax = plt.subplots(1, 3, figsize=(19, 5.2), gridspec_kw={"width_ratios":[1.3,1.3,1]})
finals = {"greedy":{}, "stoch":{}}
for pi,(key,title,greedy,tag) in enumerate([
        ("eval/greedy_win_rate","GREEDY win-rate",True,"greedy"),
        ("charts/ep_win_rate","stochastic win-rate",False,"stoch")]):
    for md in MDS:
        g,f=SRC[md]; xg,ys=pull(g,f,key,smooth=not greedy)
        if not ys: continue
        arr=np.vstack(ys); ax[pi].plot(xg, arr.mean(0), color=COL[md], lw=2.0,
            label=f"md={md} ({len(ys)})", **(dict(marker="o",ms=2) if greedy else {}))
        finals[tag][md]=float(arr[:, int(GRID*0.9):].mean())
    ax[pi].axhline(1.0, ls="--", lw=1, color="0.6"); ax[pi].set_ylim(-0.02,1.05)
    ax[pi].set_title(title); ax[pi].set_xlabel("env steps (M)"); ax[pi].set_ylabel("win rate"); ax[pi].legend(fontsize=8)
# final vs max_decisions
for tag,mk,lab in [("greedy","o-","greedy final"),("stoch","s--","stochastic final")]:
    xs=[md for md in MDS if md in finals[tag]]; ys=[finals[tag][md] for md in xs]
    if xs: ax[2].plot(xs, ys, mk, lw=2, ms=7, label=lab)
ax[2].set_xscale("log"); ax[2].set_xticks(MDS); ax[2].set_xticklabels(MDS)
ax[2].set_ylim(-0.02,1.05); ax[2].set_xlabel("max_decisions (log)"); ax[2].set_ylabel("final win rate (last 10%)")
ax[2].set_title("final vs max_decisions"); ax[2].legend(fontsize=9)
fig.suptitle("cqhex2 max_decisions sweep: does a tighter episode horizon help?", fontsize=13)
fig.tight_layout(rect=[0,0,1,0.95])
out="outputs/figs/cqhex2_maxdec_full.png"
fig.savefig(out, dpi=140); print("saved", out)
