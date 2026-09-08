"""asteroids_medium teff: does a terminal SPEED bonus make the pilot win FASTER
while KEEPING greedy pinned at 1.0? teff (graded win [10,20], centered on the
proven win_bonus=15) vs the solved fs3anneal recipe (fixed win_bonus=15). Both
fs3 + fstack4 + anneal + fixed_env=42, 150M.
Panel 1: GREEDY win-rate (MUST stay ~1.0 — did efficiency disturb the pin?).
Panel 2: raw return (teff above the ~80k base = faster goal-reaching).
Panel 3: stochastic win-rate. Saves outputs/figs/asteroids_teff.png."""
import numpy as np, matplotlib.pyplot as plt, wandb
try: plt.style.use("seaborn-v0_8-darkgrid")
except OSError: plt.style.use("seaborn-darkgrid")
ENT="truongtruong-harvard-university/analogen"; STEPS_M,GRID=150,1000
ARMS=[("asteroids_fs3_confirm","_fs3anneal_","solved (fixed win=15)","#7f8c8d"),
      ("asteroids_teff","_teff_","teff (graded speed 10->20)","#1a7a3a")]
api=wandb.Api(timeout=60)
def ema(y,a=0.1):
    o=np.empty_like(y,float);acc=y[0]
    for i,v in enumerate(y): acc=a*v+(1-a)*acc;o[i]=acc
    return o
def pull(group,filt,key,smooth):
    xg=np.linspace(0,STEPS_M,GRID);out=[]
    for r in api.runs(ENT,filters={"group":group,"state":"finished"}):
        if filt not in r.name: continue
        h=r.history(keys=[key],samples=4000)
        if key not in h.columns: continue
        h=h.dropna(subset=[key])
        if len(h)<3: continue
        x=(h["_step"]/h["_step"].max()*STEPS_M).to_numpy();y=h[key].to_numpy()
        out.append(np.interp(xg,x,ema(y) if smooth else y))
    return xg,out
fig,ax=plt.subplots(1,3,figsize=(18,5.2))
panels=[("eval/greedy_win_rate","GREEDY win-rate (must stay ~1.0)",False),
        ("charts/ep_return_mean","raw return (above 80k = faster)",True),
        ("charts/ep_win_rate","stochastic win-rate",True)]
for pi,(key,title,smooth) in enumerate(panels):
    for group,filt,label,color in ARMS:
        xg,ys=pull(group,filt,key,smooth)
        if not ys: continue
        arr=np.vstack(ys)
        ax[pi].plot(xg,arr.mean(0),color=color,lw=2.2,label=f"{label} ({len(ys)})",**(dict(marker="o",ms=2) if not smooth else {}))
        ax[pi].fill_between(xg,arr.min(0),arr.max(0),color=color,alpha=0.10)
    ax[pi].set_title(title);ax[pi].set_xlabel("env steps (M)");ax[pi].legend(fontsize=8)
    if "win_rate" in key: ax[pi].set_ylim(-0.02,1.05); ax[pi].axhline(1.0,ls="--",lw=1,color="0.6")
ax[1].axhline(80000,ls=":",lw=1,color="0.5"); ax[1].text(2,81000,"~80k base (0 speed bonus)",fontsize=7,color="0.4")
fig.suptitle("asteroids_medium teff: faster wins WITHOUT losing the greedy=1.0 pin?",fontsize=13)
fig.tight_layout(rect=[0,0,1,0.95]);fig.savefig("outputs/figs/asteroids_teff.png",dpi=140);print("saved outputs/figs/asteroids_teff.png")
