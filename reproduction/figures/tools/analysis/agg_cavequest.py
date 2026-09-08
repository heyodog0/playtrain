import json, glob, re
def curve(tag):
    out={}
    for f in glob.glob("outputs/impala_%s_*/heldout_eval.json"%tag):
        N=int(re.search(r"_N(\d+)",f).group(1)); out[N]=json.load(open(f))["heldout_win_rate"]
    return out
l=curve("cavequest_finesweep"); f=curve("cavequest_ff_nsweep")
print("=== cavequest_easy IMPALA-LSTM (N=1-10) ===")
for N in sorted(l): print("  N=%2d: %.3f"%(N,l[N]))
print("=== cavequest_easy IMPALA-FF (coarse) ===")
for N in sorted(f): print("  N=%3d: %.3f"%(N,f[N]))
