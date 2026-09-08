"""cqhex2 teff win_bonus_max (efficiency-gradient strength) sweep. Bigger spread
[3, win_bonus_max] = stronger pull to win fast. {6,12,16} vs 8 (cqhex2_teff).
Does more spread -> faster wins (return further above the 80k slow-win ceiling)
WITHOUT losing win-rate (watch 16 for symlog-style exploration detuning)?
Panel 1: raw return (higher above 80k = faster). Panel 2: win-rate.
Panel 3: final return-above-80k (speed) vs win_bonus_max. Saves cqhex2_teff_max.png."""
import numpy as np, matplotlib.pyplot as plt, matplotlib.cm as cm, wandb
try: plt.style.use("seaborn-v0_8-darkgrid")
except OSError: plt.style.use("seaborn-darkgrid")
ENT="truongtruong-harvard-university/analogen"; STEPS_M,GRID=150,1000
SRC={6:("cqhex2_teff_max","_teffmax6_"),8:("cqhex2_teff","_teff_s"),
     12:("cqhex2_teff_max","_teffmax12_"),16:("cqhex2_teff_max","_teffmax16_")}
MS=sorted(SRC); cmap=cm.get_cmap("plasma"); COL={m:cmap(i/(len(MS)-1)) for i,m in enumerate(MS)}
api=wandb.Api(timeout=60)
def ema(y,a=0.08):
    o=np.empty_like(y,float);acc=y[0]
    for i,v in enumerate(y): acc=a*v+(1-a)*acc;o[i]=acc
    return o
def pull(group,filt,key):
    xg=np.linspace(0,STEPS_M,GRID);out=[]
    for r in api.runs(ENT,filters={"group":group,"state":"finished"}):
        if filt not in r.name: continue
        h=r.history(keys=[key],samples=4000)
        if key not in h.columns: continue
        h=h.dropna(subset=[key])
        if len(h)<5: continue
        x=(h["_step"]/h["_step"].max()*STEPS_M).to_numpy();out.append(np.interp(xg,x,ema(h[key].to_numpy())))
    return xg,out
fig,ax=plt.subplots(1,3,figsize=(19,5.2),gridspec_kw={"width_ratios":[1.3,1.3,1]})
finalspeed={}; finalwr={}
for m in MS:
    g,f=SRC[m]
    xg,rc=pull(g,f,"charts/ep_return_mean")
    if rc:
        arr=np.vstack(rc); ax[0].plot(xg,arr.mean(0),color=COL[m],lw=2,label=f"max={m} ({len(rc)})")
        finalspeed[m]=float(arr[:,int(GRID*0.9):].mean()-80000)
    xg,wc=pull(g,f,"charts/ep_win_rate")
    if wc:
        arr=np.vstack(wc); ax[1].plot(xg,arr.mean(0),color=COL[m],lw=2,label=f"max={m}")
        finalwr[m]=float(arr[:,int(GRID*0.9):].mean())
ax[0].axhline(80000,ls=":",lw=1,color="0.5"); ax[0].text(2,81000,"80k slow-win ceiling",fontsize=7,color="0.4")
ax[0].set_title("raw return (higher above 80k = faster wins)"); ax[0].set_xlabel("env steps (M)"); ax[0].set_ylabel("return"); ax[0].legend(fontsize=8)
ax[1].set_ylim(-0.02,1.05); ax[1].set_title("win-rate (watch max=16 for detuning)"); ax[1].set_xlabel("env steps (M)"); ax[1].legend(fontsize=8)
xs=MS
ax2=ax[2]; ax2b=ax2.twinx()
l1=ax2.plot(xs,[finalspeed.get(m,np.nan) for m in xs],"o-",color="#8e44ad",lw=2,label="return above 80k (speed)")
l2=ax2b.plot(xs,[finalwr.get(m,np.nan) for m in xs],"s--",color="#1a7a3a",lw=2,label="final win-rate")
ax2.set_xlabel("win_bonus_max"); ax2.set_ylabel("final return above 80k",color="#8e44ad")
ax2b.set_ylabel("final win-rate",color="#1a7a3a"); ax2b.set_ylim(0,1.05)
ax2.set_title("speed & win-rate vs spread"); ax2.legend(l1+l2,[x.get_label() for x in l1+l2],fontsize=8,loc="center right")
fig.suptitle("cqhex2 teff: how hard to push efficiency (win_bonus_max) before it costs win-rate?",fontsize=13)
fig.tight_layout(rect=[0,0,1,0.95]); fig.savefig("outputs/figs/cqhex2_teff_max.png",dpi=140); print("saved outputs/figs/cqhex2_teff_max.png")
