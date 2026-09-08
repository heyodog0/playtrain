"""Do the encoder FLOP savings translate to wall-clock on an H100?

FLOPs are necessary but not sufficient: at RL batch sizes these kernels can be
launch-bound, where a 4x FLOP cut buys far less. Times forward and
forward+backward at the batch sizes the trainers actually use -- IMPALA's
learner batch (256x64 unrolled = 16,384) and PPO's minibatch (3,072).
"""
import time, torch, torch.nn as nn, torch.nn.functional as F
from playtrain_trainers.policy import ImpalaCNN, NatureCNN, _ResidualBlock

class DWResidual(nn.Module):
    def __init__(s,c):
        super().__init__()
        s.dw1=nn.Conv2d(c,c,3,1,1,groups=c); s.pw1=nn.Conv2d(c,c,1)
        s.dw2=nn.Conv2d(c,c,3,1,1,groups=c); s.pw2=nn.Conv2d(c,c,1)
    def forward(s,x):
        h=F.relu(x); h=s.pw1(s.dw1(h)); h=F.relu(h); h=s.pw2(s.dw2(h)); return x+h

class Stage(nn.Module):
    def __init__(s,ic,oc,stride=1,nres=2,block=_ResidualBlock):
        super().__init__()
        s.conv=nn.Conv2d(ic,oc,3,stride,1); s.pool=nn.MaxPool2d(3,2,1)
        s.res=nn.Sequential(*[block(oc) for _ in range(nres)])
    def forward(s,x): return s.res(s.pool(s.conv(x)))

class Variant(nn.Module):
    def __init__(s,depths=(16,32,32),stem_stride=1,nres=2,block=_ResidualBlock,in_c=3,fd=256,hw=64):
        super().__init__()
        st,c=[],in_c
        for i,d in enumerate(depths):
            st.append(Stage(c,d,stem_stride if i==0 else 1,nres,block)); c=d
        s.stages=nn.Sequential(*st)
        with torch.no_grad():
            flat=s.stages(torch.zeros(1,in_c,hw,hw)).flatten(1).shape[1]
        s.fc=nn.Linear(flat,fd)
    def forward(s,x):
        x=x.float()/255.0; x=s.stages(x); x=F.relu(x).flatten(1); return F.relu(s.fc(x))

dev = torch.device("cuda")

def timeit(model, B, bwd, iters=30, bf16=True):
    model = model.to(dev).to(memory_format=torch.channels_last)
    x = torch.randint(0, 255, (B,3,64,64), dtype=torch.uint8, device=dev)
    x = x.to(memory_format=torch.channels_last)
    ac = torch.autocast("cuda", dtype=torch.bfloat16) if bf16 else torch.autocast("cuda", enabled=False)
    for _ in range(8):
        with ac:
            y = model(x)
        if bwd: y.sum().backward(); model.zero_grad(set_to_none=True)
    torch.cuda.synchronize(); t0=time.perf_counter()
    for _ in range(iters):
        with ac:
            y = model(x)
        if bwd: y.sum().backward(); model.zero_grad(set_to_none=True)
    torch.cuda.synchronize()
    return (time.perf_counter()-t0)/iters*1000

cands = [
  ("Nature",                   lambda: NatureCNN(3,512,input_hw=64)),
  ("IMPALA-CNN (baseline)",    lambda: Variant()),
  ("+ stride-2 stem",          lambda: Variant(stem_stride=2)),
  ("+ 1 res block/stage",      lambda: Variant(nres=1)),
  ("stride-2 + 1 res",         lambda: Variant(stem_stride=2,nres=1)),
  ("depths (8,16,16)",         lambda: Variant(depths=(8,16,16))),
  ("depthwise-separable res",  lambda: Variant(block=DWResidual)),
  ("stride-2 + depthwise",     lambda: Variant(stem_stride=2,block=DWResidual)),
]
for B in (3072, 16384):
    print(f"\n=== batch {B} (bf16, channels_last) ===")
    print("%-26s %11s %11s" % ("encoder","fwd ms","fwd+bwd ms"))
    base_f=base_b=None
    for name, mk in cands:
        f = timeit(mk(), B, False); b = timeit(mk(), B, True)
        if name.startswith("IMPALA-CNN"): base_f, base_b = f, b
        sf = f"{base_f/f:.2f}x" if base_f else ""
        sb = f"{base_b/b:.2f}x" if base_b else ""
        print("%-26s %8.2f %-4s %8.2f %-4s" % (name, f, sf, b, sb))
