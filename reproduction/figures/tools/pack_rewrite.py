"""packed4.sh helper: copy a config with log_dir suffixed by the job id, so a
rerun never auto-resumes a previous experiment that shared the config."""
import json
import sys

src, dst, suffix = sys.argv[1], sys.argv[2], sys.argv[3]
cfg = json.load(open(src))
cfg["log_dir"] = f"{cfg['log_dir']}_{suffix}"
json.dump(cfg, open(dst, "w"), indent=2)
print(f"{dst}: log_dir={cfg['log_dir']}")
