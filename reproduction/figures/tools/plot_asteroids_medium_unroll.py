"""asteroids_medium training-return curves across the unroll/backprop lever sweep.
Pulls charts/ep_return_mean from W&B for every asteroids_medium run, colored by
unroll_length (the BPTT/V-trace window the sweep pushed: 100->400->3000->4000->5000;
batch_size drops 16->8 for the long unrolls to fit memory). Two panels: full y-range
(shows the lone env42 memorizer) and zoomed 0-4k (the plateaued lever sweep)."""
import re
from collections import defaultdict
import numpy as np, matplotlib as mpl, matplotlib.pyplot as plt
import wandb
try: plt.style.use("seaborn-v0_8-darkgrid")
except OSError: plt.style.use("seaborn-darkgrid")

ENT="truongtruong-harvard-university/analogen"
KEY="charts/ep_return_mean"
api=wandb.Api(timeout=60)

def ema(y, a=0.1):
    o=np.empty_like(y,float); acc=y[0]
    for i,v in enumerate(y): acc=a*v+(1-a)*acc; o[i]=acc
    return o

# all asteroids_medium runs, dedup by name (keep longest history)
runs=[r for r in api.runs(ENT) if "aste_medium" in (r.name or "").lower()]
best={}
for r in runs:
    h=r.history(keys=[KEY], samples=1500)
    if h.empty or KEY not in h: continue
    h=h.dropna(subset=[KEY])
    if h.empty: continue
    if r.name not in best or len(h)>best[r.name][1]:
        best[r.name]=(r,len(h),h)

rows=[]
for name,(r,n,h) in best.items():
    c=r.config
    total=float(c.get("total_steps",40_000_000))
    x=(h["_step"]/h["_step"].max()*(total/1e6)).to_numpy()
    yraw=h[KEY].to_numpy()
    rows.append(dict(name=name, u=c.get("unroll_length"), bs=c.get("batch_size"),
                     fs=c.get("frame_stack"), g=c.get("discounting"),
                     clip=c.get("reward_clipping"), ent=c.get("entropy_cost"),
                     x=x, y=ema(yraw), yraw=yraw, ymax=float(np.max(yraw))))

unrolls=sorted({r["u"] for r in rows})
cmap=mpl.cm.viridis
cidx={u:cmap(i/max(1,len(unrolls)-1)) for i,u in enumerate(unrolls)}
print("unroll values:", unrolls, " n_runs:", len(rows))

fig,(axF,axB)=plt.subplots(1,2,figsize=(15.5,6))

# --- L: full-range return curves, raw (thin) + EMA (bold), colored by unroll ---
for r in sorted(rows,key=lambda d:(d["u"] or 0)):
    axF.plot(r["x"], r["yraw"], lw=0.5, alpha=.25, color=cidx[r["u"]])
    axF.plot(r["x"], r["y"],    lw=1.8, alpha=.9,  color=cidx[r["u"]])
axF.set_ylim(-1500,85000)
axF.axhline(30000, ls="--", lw=1.3, color="0.35")
axF.text(0.5,31000,"win threshold 30k",fontsize=9,color="0.3")
axF.set_xlabel("env steps (millions)",fontsize=12)
axF.set_ylabel("training return (ep mean; thin=raw, bold=EMA)",fontsize=12)
axF.set_title("return curves — raw batch-mean spikes to the win band (~83k), EMA never holds",fontsize=12)
handles=[mpl.lines.Line2D([],[],color=cidx[u],lw=3,
         label=f"unroll={u} (bs={[r['bs'] for r in rows if r['u']==u][0]})") for u in unrolls]
axF.legend(handles=handles, loc="upper right", fontsize=9, title="BPTT / V-trace window")

# --- R: fraction of training updates in each return band, averaged by unroll ---
BANDS=[("<2k",0,2000),("2-10k",2000,10000),("10-30k",10000,30000),(">30k WIN",30000,1e9)]
bandcol=["#c44e52","#dd8452","#8172b3","#55a868"]
byU=defaultdict(list)
for r in rows:
    y=r["yraw"]; fr=[np.mean((y>=lo)&(y<hi)) for _,lo,hi in BANDS]; byU[r["u"]].append(fr)
xU=np.arange(len(unrolls)); bottom=np.zeros(len(unrolls))
for bi,(lab,_,_) in enumerate(BANDS):
    vals=np.array([np.mean([f[bi] for f in byU[u]]) for u in unrolls])*100
    axB.bar(xU, vals, bottom=bottom, color=bandcol[bi], label=lab, width=.7)
    bottom+=vals
axB.set_xticks(xU); axB.set_xticklabels([f"u={u}" for u in unrolls])
axB.set_ylabel("% of training updates in return band",fontsize=12)
axB.set_title("where training actually sits: mostly <2k, brief win spikes",fontsize=12)
axB.legend(loc="lower right", fontsize=9, title="return band")

fig.suptitle("asteroids_medium: training return across the unroll/backprop sweep (single-env env42/43, win=+30k)\n"
             "Not an exploration wall — every config hits full-win batches (~83k) intermittently but COLLAPSES "
             "(<2k ~65-77% of the time). Pushing unroll 100→5000 changed variance, not convergence.",
             fontsize=12)
fig.tight_layout(rect=[0,0,1,0.92])
out="outputs/figs/asteroids_medium_unroll.png"
fig.savefig(out,dpi=150); print("saved",out)

# summary table
print(f"\n{'run':54} {'unroll':>6} {'bs':>3} {'clip':>8} {'fs':>3} {'g':>6} {'maxret':>8}")
for r in sorted(rows,key=lambda d:-(d['ymax'])):
    print(f"{r['name']:54} {str(r['u']):>6} {str(r['bs']):>3} {str(r['clip']):>8} {str(r['fs']):>3} {str(r['g']):>6} {r['ymax']:8.0f}")
