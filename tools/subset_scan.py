"""Static coverage scan: classify games by native-compile subset (see
docs/NATIVE_COMPILE.md). Heuristic feature-presence scan (not a full parser) —
an upper-bound estimate of what would compile.

    python tools/subset_scan.py [games_dir]   # default examples/games/js

GREEN  = pure v0 subset (structs + vectors + immediate closures + p5 API)
YELLOW = compilable, needs runtime support (HashMap / Set / dict-iter / sort-cmp)
RED    = V8 fallback (no clean native lowering)
"""
import re, glob, os, sys, collections

GAMES = sys.argv[1] if len(sys.argv) > 1 else "examples/games/js"


def strip_comments_strings(s: str) -> str:
    """Remove // and /* */ comments and string/template contents so keyword
    scans don't match words inside comments or strings."""
    s = re.sub(r"/\*.*?\*/", " ", s, flags=re.S)   # block comments
    s = re.sub(r"//[^\n]*", " ", s)                 # line comments
    s = re.sub(r'"(?:\\.|[^"\\])*"', '""', s)       # dq strings
    s = re.sub(r"'(?:\\.|[^'\\])*'", "''", s)       # sq strings
    s = re.sub(r"`(?:\\.|[^`\\])*`", "``", s)       # template literals
    return s

RED = {  # truly hard -> V8 fallback
    "class": r"\bclass\s+\w",
    "generator": r"function\s*\*|\byield\b",
    "eval/Function": r"\beval\s*\(|new\s+Function\b",
    "Symbol/Proxy": r"\bSymbol\s*\(|\bProxy\s*\(",
    "async": r"\basync\b|\bawait\b",
    "getter/setter": r"\bget\s+\w+\s*\([^)]*\)\s*\{|\bset\s+\w+\s*\([^)]*\)\s*\{",
    "real-regex": r"\.(match|replace|test|exec)\s*\(|new\s+RegExp",
}
YELLOW = {  # compilable with bounded runtime support
    "dyn-dict(delete)": r"\bdelete\s+\w",
    "Map/Set": r"\bnew\s+(Map|Set|WeakMap|WeakSet)\b",
    "Object.*": r"\bObject\.(keys|values|entries|assign)\b",
    "typeof": r"\btypeof\b",
    "obj-spread": r"\{\s*\.\.\.",
    ".sort(cmp)": r"\.sort\s*\(\s*[\(a-zA-Z]",
    ".reduce": r"\.reduce\b",
}


def main():
    games = sorted(glob.glob(os.path.join(GAMES, "*.js")))
    red_hits, yel_hits = collections.Counter(), collections.Counter()
    cls = {"GREEN": 0, "YELLOW": 0, "RED": 0}
    red_games, yellow_games = [], []
    for f in games:
        s = strip_comments_strings(open(f).read())
        r = [k for k, p in RED.items() if re.search(p, s)]
        y = [k for k, p in YELLOW.items() if re.search(p, s)]
        for k in r: red_hits[k] += 1
        for k in y: yel_hits[k] += 1
        if r:
            cls["RED"] += 1; red_games.append((os.path.basename(f), r))
        elif y:
            cls["YELLOW"] += 1; yellow_games.append((os.path.basename(f), y))
        else:
            cls["GREEN"] += 1
    n = len(games) or 1
    print(f"=== {len(games)} games in {GAMES} ===")
    for k in ("GREEN", "YELLOW", "RED"):
        print(f"{k:7}: {cls[k]:3}  ({round(100*cls[k]/n)}%)")
    comp = cls["GREEN"] + cls["YELLOW"]
    print(f"compilable (GREEN+YELLOW): {comp}/{len(games)} ({round(100*comp/n)}%)")
    print("\nRED triggers:")
    for k, c in red_hits.most_common(): print(f"  {k:16} {c}")
    print("\nYELLOW triggers (runtime features needed):")
    for k, c in yel_hits.most_common(): print(f"  {k:18} {c}")
    print("\nRED games:")
    for g, r in red_games: print(f"  {g:40} {r}")


if __name__ == "__main__":
    main()
