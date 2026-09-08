"""cqhex2 unroll_length (BPTT / V-trace window) sweep on the fixed-env recipe:
does a longer unroll make the return curves more MONOTONIC and stabilize the
knife-edge greedy? {50,200,400} vs 100 baseline (cqhex2_fixed42). Panel 1:
stochastic return (colored by unroll). Panel 2: greedy win-rate (does deeper BPTT
kill the 0<->1 thrash?). Panel 3: monotonicity metrics vs unroll — return
max-drawdown (lower=smoother) + greedy stability (frac late evals at win).
Saves outputs/figs/cqhex2_unroll.png."""
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
SRC = {50:("cqhex2_unroll","_unroll50_"), 100:("cqhex2_fixed42","_fixed42_"),
       200:("cqhex2_unroll","_unroll200_"), 400:("cqhex2_unroll","_unroll400_")}
US = sorted(SRC)
cmap = cm.get_cmap("viridis"); COL={u:cmap(i/(len(US)-1)) for i,u in enumerate(US)}
api = wandb.Api(timeout=60)

def ema(y, a=0.08):
    o=np.empty_like(y,float); acc=y[0]
    for i,v in enumerate(y): acc=a*v+(1-a)*acc; o[i]=acc
    return o

def pull(group, filt, key, smooth):
    xg=np.linspace(0,STEPS_M,GRID); curves=[]; latewin=[]
    for r in api.runs(ENT, filters={"group":group,"state":"finished"}):
        if filt not in r.name: continue
        h=r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h=h.dropna(subset=[key])
        if len(h)<5: continue
        x=(h["_step"]/h["_step"].max()*STEPS_M).to_numpy(); y=h[key].to_numpy()
        curves.append(np.interp(xg, x, ema(y) if smooth else y))
        if "greedy" in key:
            late=y[x/STEPS_M>0.6]
            if len(late): latewin.append(float((late>=0.999).mean()))
    return xg, curves, latewin

fig, ax = plt.subplots(1, 3, figsize=(19,5.2), gridspec_kw={"width_ratios":[1.3,1.3,1]})
drawdown={}; gstab={}
for u in US:
    g,f=SRC[u]
    xg,rc,_=pull(g,f,"charts/ep_return_mean",smooth=True)
    if rc:
        arr=np.vstack(rc); m=arr.mean(0)
        ax[0].plot(xg, m, color=COL[u], lw=2.0, label=f"unroll={u} ({len(rc)})")
        # return max-drawdown (after first reaching 60% of its own peak)
        pk=np.maximum.accumulate(m); drawdown[u]=float((pk-m).max())
    xg,gc,lw=pull(g,f,"eval/greedy_win_rate",smooth=False)
    if gc:
        arr=np.vstack(gc); ax[1].plot(xg, arr.mean(0), color=COL[u], lw=2.0, marker="o", ms=2, label=f"unroll={u}")
        gstab[u]=float(np.mean(lw)) if lw else np.nan
ax[0].set_title("stochastic return (smoother = more monotonic)"); ax[0].set_xlabel("env steps (M)"); ax[0].set_ylabel("return"); ax[0].legend(fontsize=8)
ax[1].set_ylim(-0.02,1.05); ax[1].axhline(1.0,ls="--",lw=1,color="0.6")
ax[1].set_title("greedy win-rate (does BPTT kill the thrash?)"); ax[1].set_xlabel("env steps (M)"); ax[1].set_ylabel("win rate"); ax[1].legend(fontsize=8)
# metrics vs unroll
xs=US
dd=[drawdown.get(u,np.nan) for u in xs]
gs=[gstab.get(u,np.nan) for u in xs]
ax2=ax[2]; ax2b=ax2.twinx()
l1=ax2.plot(xs, dd, "o-", color="#c0392b", lw=2, label="return max-drawdown")
l2=ax2b.plot(xs, gs, "s--", color="#1a7a3a", lw=2, label="greedy stability")
ax2.set_xscale("log"); ax2.set_xticks(xs); ax2.set_xticklabels(xs)
ax2.set_xlabel("unroll_length (log)"); ax2.set_ylabel("return max-drawdown (lower=smoother)", color="#c0392b")
ax2b.set_ylabel("greedy stability (higher=better)", color="#1a7a3a"); ax2b.set_ylim(-0.02,1.05)
ax2.set_title("monotonicity vs unroll"); ax2.legend(l1+l2,[x.get_label() for x in l1+l2], fontsize=8, loc="center right")
fig.suptitle("cqhex2 unroll (BPTT) sweep: does a longer window make return curves more monotonic?", fontsize=13)
fig.tight_layout(rect=[0,0,1,0.95])
out="outputs/figs/cqhex2_unroll.png"
fig.savefig(out, dpi=140); print("saved", out)
