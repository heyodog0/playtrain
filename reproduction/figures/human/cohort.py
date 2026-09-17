"""Who the 20 participants are, and which of the paper's cohort claims hold.

main.tex L702-706 says: 20 participants, mean age 32.4 (SD 9.0, range 19-54),
6 female and 14 male, each playing eight named games for 100 seconds.

data/study/ holds 30 session files. The 20 that count are selected the way
plot_wallclock5.py selects them: drop non-participant ids (probe, playtest,
debug, ...), drop sessions started before MIN_START, drop partials. Exact ages
are NOT in the committed data -- anonymize_study_data.py replaces them with
bands -- so the paper's age mean, SD and range cannot be recomputed here.

    python cohort.py STUDY_DATA_DIR
"""
import collections
import glob
import json
import os
import re
import sys

MIN_START = "2026-08-05T16:52:00Z"
NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)', re.I)
GAMES = ["asteroids", "breakout", "seaquest", "caveflyer",
         "coinrun", "plunder", "flappy_bird", "vvvvvv"]


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else "../../data/study"
    sessions = []
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        try:
            sessions.append(json.load(open(f)))
        except Exception:
            continue
    kept, dropped = [], []
    for s in sessions:
        pid = s.get("participantId", "")
        if NON_PARTICIPANT.match(pid) or s.get("startedAt", "") < MIN_START or s.get("partial"):
            dropped.append(pid)
        else:
            kept.append(s)

    print(f"    sessions on disk {len(sessions)}, kept {len(kept)}, dropped {len(dropped)}"
          f"   (paper: 20 participants)")
    if dropped:
        print(f"      dropped: {', '.join(sorted(dropped))}  (before MIN_START {MIN_START},"
              " non-participant id, or partial)")

    blocks = collections.Counter(b.get("game") for s in kept for b in s.get("blocks", []))
    missing = [g for g in GAMES if g not in blocks]
    extra = [g for g in blocks if g not in GAMES]
    print(f"    games {len(blocks)}: {', '.join(f'{g} x{blocks[g]}' for g in GAMES if g in blocks)}"
          f"   (paper: eight named games)")
    if missing or extra:
        print(f"      MISSING {missing}  UNEXPECTED {extra}")

    gender = collections.Counter(s["demographics"].get("gender") for s in kept)
    print(f"    gender: {dict(gender)}   (paper: 6 female, 14 male)")
    bands = collections.Counter(s["demographics"].get("ageBand") for s in kept)
    print(f"    ageBand: {dict(bands)}")
    print("    exact ages are not committed (anonymized to bands), so the paper's"
          " mean 32.4 / SD 9.0 / range 19-54 cannot be recomputed here")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
