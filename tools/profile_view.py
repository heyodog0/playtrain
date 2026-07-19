"""CLI: render a V8 .cpuprofile as a terminal table (Left Heavy view).

Parses the JSON profile written by `node --cpu-prof`, aggregates time
per function across all call-tree nodes (so the same function called
from multiple places sums into one row), and prints a sorted table.

Usage:
    uv run python tools/profile_view.py                       # newest profile, by self time
    uv run python tools/profile_view.py --by total            # sort by total (inclusive) time
    uv run python tools/profile_view.py path/to.cpuprofile    # specific file
    uv run python tools/profile_view.py --limit 30 --min-pct 0.5
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIR = REPO_ROOT / "outputs" / "profile"


def find_newest_profile() -> Path:
    profiles = sorted(DEFAULT_DIR.glob("*.cpuprofile"),
                      key=lambda p: p.stat().st_mtime, reverse=True)
    if not profiles:
        sys.exit(f"No .cpuprofile files found under {DEFAULT_DIR}. "
                 f"Run `just profile-cpu <game>` first.")
    return profiles[0]


def short_location(url: str, line: int) -> str:
    """Trim file URLs to repo-relative-ish paths so the table stays readable."""
    if not url:
        return ""
    # Strip file:// and the repo root prefix if present
    if url.startswith("file://"):
        url = url[len("file://"):]
    repo_str = str(REPO_ROOT)
    if url.startswith(repo_str):
        url = url[len(repo_str) + 1:]
    if line:
        return f"{url}:{line}"
    return url


def load_profile(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def compute_times(profile: dict) -> tuple[dict[int, int], dict[int, int], dict[int, dict]]:
    """Return (self_us, total_us, nodes_by_id). Times are in microseconds.

    V8 cpuprofile schema:
      - nodes: [{ id, callFrame:{functionName, url, lineNumber, ...}, hitCount, children:[ids] }]
      - samples: [nodeId, ...]              # which node was on top of stack at each tick
      - timeDeltas: [us, ...]               # time since previous sample (so total time at samples[i] is timeDeltas[i])
    """
    nodes_by_id = {n["id"]: n for n in profile["nodes"]}
    samples = profile["samples"]
    deltas = profile["timeDeltas"]

    self_us: dict[int, int] = defaultdict(int)
    for nid, dt in zip(samples, deltas):
        # Negative deltas occur occasionally (clock skew at start); clamp to 0.
        self_us[nid] += max(0, dt)

    # Total time = self + sum of children's total. Iterative post-order walk
    # over the call tree (rooted at the "(root)" node, typically id=1).
    total_us: dict[int, int] = {}
    # Find roots: any node not referenced as a child. For a well-formed
    # cpuprofile, only one root exists ("(root)").
    child_ids: set[int] = set()
    for n in nodes_by_id.values():
        child_ids.update(n.get("children", []))
    roots = [nid for nid in nodes_by_id if nid not in child_ids]

    # Iterative DFS so we don't blow Python's recursion limit on deep stacks.
    for root in roots:
        stack = [(root, False)]
        while stack:
            nid, processed = stack.pop()
            if processed:
                t = self_us.get(nid, 0)
                for c in nodes_by_id[nid].get("children", []):
                    t += total_us[c]
                total_us[nid] = t
            else:
                stack.append((nid, True))
                for c in nodes_by_id[nid].get("children", []):
                    stack.append((c, False))

    return self_us, total_us, nodes_by_id


def aggregate_by_function(nodes_by_id: dict[int, dict],
                          self_us: dict[int, int],
                          total_us: dict[int, int]) -> list[dict]:
    """Same (functionName, url, line) → one row. Sums self; for total, sums
    only roots of contiguous same-function chains so we don't double-count
    when the same function is recursively / repeatedly hit."""
    # Self is trivially additive.
    agg_self: dict[tuple, int] = defaultdict(int)
    agg_total: dict[tuple, int] = defaultdict(int)
    hits: dict[tuple, int] = defaultdict(int)
    samples_self: dict[tuple, int] = defaultdict(int)  # sample count per fn for self time
    sample_total_count = sum(1 for _ in self_us)  # not strictly used; placeholder
    locations: dict[tuple, str] = {}

    def fn_key(n: dict) -> tuple:
        cf = n["callFrame"]
        return (cf.get("functionName") or "(anonymous)",
                cf.get("url", ""),
                cf.get("lineNumber", 0))

    # Build child→parent for the "topmost same-fn ancestor" check.
    parent: dict[int, int] = {}
    for n in nodes_by_id.values():
        for c in n.get("children", []):
            parent[c] = n["id"]

    for nid, n in nodes_by_id.items():
        key = fn_key(n)
        agg_self[key] += self_us.get(nid, 0)
        hits[key] += n.get("hitCount", 0)
        if key not in locations:
            cf = n["callFrame"]
            locations[key] = short_location(cf.get("url", ""), cf.get("lineNumber", 0))

        # For total time: only count this node's total if its parent has a
        # different function key (otherwise we'd double-count recursive calls).
        pid = parent.get(nid)
        if pid is None or fn_key(nodes_by_id[pid]) != key:
            agg_total[key] += total_us.get(nid, 0)

    keys = set(agg_self) | set(agg_total)
    rows = [{
        "name": k[0],
        "location": locations.get(k, ""),
        "self_us": agg_self.get(k, 0),
        "total_us": agg_total.get(k, 0),
        "hits": hits.get(k, 0),
    } for k in keys]
    return rows


def format_us(us: int) -> str:
    if us >= 1_000_000:
        return f"{us / 1_000_000:.2f}s"
    if us >= 1_000:
        return f"{us / 1_000:.1f}ms"
    return f"{us}μs"


def render_table(rows: list[dict], total_run_us: int, *,
                 sort_by: str, limit: int, min_pct: float) -> None:
    key = "self_us" if sort_by == "self" else "total_us"
    rows = sorted(rows, key=lambda r: r[key], reverse=True)

    print()
    header = f"{'rank':>4}  {'self':>8} {'self%':>6}  {'total':>8} {'tot%':>6}   {'function':<40}  location"
    print(header)
    print("-" * len(header))

    shown = 0
    for i, r in enumerate(rows):
        self_pct = (r["self_us"] / total_run_us * 100) if total_run_us else 0
        total_pct = (r["total_us"] / total_run_us * 100) if total_run_us else 0
        if max(self_pct, total_pct) < min_pct:
            continue
        if shown >= limit:
            break
        name = r["name"][:40]
        loc = r["location"][:60]
        print(f"{i+1:>4}  {format_us(r['self_us']):>8} {self_pct:>5.1f}%  "
              f"{format_us(r['total_us']):>8} {total_pct:>5.1f}%   "
              f"{name:<40}  {loc}")
        shown += 1
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("path", nargs="?", default=None,
                        help="Path to .cpuprofile (default: newest in outputs/profile/)")
    parser.add_argument("--by", choices=["self", "total"], default="self",
                        help="Sort by self or total (inclusive) time")
    parser.add_argument("--limit", type=int, default=25,
                        help="Max rows to print (default 25)")
    parser.add_argument("--min-pct", type=float, default=0.1,
                        help="Hide rows below this %% of total run (default 0.1)")
    args = parser.parse_args()

    path = Path(args.path) if args.path else find_newest_profile()
    if not path.exists():
        sys.exit(f"Profile not found: {path}")

    profile = load_profile(path)
    self_us, total_us, nodes_by_id = compute_times(profile)
    rows = aggregate_by_function(nodes_by_id, self_us, total_us)

    total_run_us = sum(self_us.values())
    run_wall_us = (profile.get("endTime", 0) - profile.get("startTime", 0))

    print(f"Profile: {path}")
    print(f"Wall time:  {format_us(run_wall_us)}")
    print(f"CPU time:   {format_us(total_run_us)}  (sum of all self times)")
    print(f"Sort by:    {args.by} time")

    render_table(rows, total_run_us,
                 sort_by=args.by, limit=args.limit, min_pct=args.min_pct)
    return 0


if __name__ == "__main__":
    sys.exit(main())
