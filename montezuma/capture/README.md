# Capture tooling — ground-truth RAM + pixels

The faithful-port pipeline has **two data sources** (see `../PLAN.md`):

| Source | Gives you | Tool |
|---|---|---|
| **RAM** (dynamic state) | player x/y, room, lives, enemy timers, per-frame movement deltas | this folder |
| **ROM / pixels** (static geometry) | wall/ladder/platform layout per room, sprite art | frame PNGs from this folder, traced by hand |

> The single most important misconception to avoid: **level geometry is NOT in the
> 128 bytes of 2600 RAM.** RAM gives dynamics; geometry comes from the rendered
> pixels (or a ROM disassembly). The logger captures both so you can merge them.

## Recommended: ALE in Python (`ale_ram_logger.py`)

Closest-to-source and already aligned with gym-gen (a Gymnasium project; the catalog
refs `ale.farama.org`). One-time install (not yet in gym-gen deps):

```bash
uv pip install "ale-py>=0.10" "gymnasium>=1.1" pillow
```

Then:

```bash
# 1. movement tables — deterministic script, dump frames too
python ale_ram_logger.py --script walk_right.txt --frames

# 2. exercise rooms/enemies (for RAM diffing + room backgrounds)
python ale_ram_logger.py --random 600 --frames

# 3. derive RAM->pixel x mapping
python ale_ram_logger.py --calibrate
```

Outputs land in `../data/`: `ram_<label>.csv` (one row per frame: action, labeled
fields, `dx`/`dy`, and all 128 raw bytes `r0..r127`) and `frames_<label>/*.png`.

## Alternative: BizHawk (`bizhawk_log_ram.lua`)

Use when you want a GUI emulator to frame-step by hand and watch RAM live. Open the
ROM in BizHawk → Tools → Lua Console → run the script. Same address map.

## Alternative: Stella

Stella's debugger (`-debug`, `ram` command) reads RAM but has **no clean per-frame
logging loop** — it's prompt-driven. Fine for one-off address hunting, poor for the
per-frame tables we need. Prefer ALE or BizHawk.

## Addresses

All three tools read `ram_map.json`. Those addresses are **literature defaults and
unverified** — confirm each one before trusting it (drive a known input, watch the
byte move). Update `verify: true` as you confirm them.
