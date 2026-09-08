"""Template with vec_workers / vec_env_threads / batch_size overridden."""
import json, sys
src, dst, w, t = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
b = int(sys.argv[5]) if len(sys.argv) > 5 else None
c = json.load(open(src))
c["vec_workers"] = w
c["vec_env_threads"] = t
if b:
    c["batch_size"] = b
json.dump(c, open(dst, "w"), indent=2)
