import os, sys, time
import torch

mode = sys.argv[1]
if mode == "child":
    idx = int(sys.argv[2])
    torch.zeros(8, device=torch.device("cuda", idx % 2))
    print(f"ctx {idx} ok", flush=True)
    time.sleep(3)
    sys.exit(0)

import subprocess
here = os.path.abspath(__file__)
if mode == "stagger":
    procs = []
    for i in range(6):
        procs.append(subprocess.Popen([sys.executable, here, "child", str(i)]))
        time.sleep(2.0)
    rc = [p.wait() for p in procs]
    print("stagger exit codes:", rc)
elif mode == "warmheld":
    t = torch.zeros(8, device="cuda:0")
    u = torch.zeros(8, device="cuda:1")
    print("parent holds contexts on both GPUs", flush=True)
    procs = [subprocess.Popen([sys.executable, here, "child", str(i)]) for i in range(6)]
    rc = [p.wait() for p in procs]
    print("warmheld exit codes:", rc)
