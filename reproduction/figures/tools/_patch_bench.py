from pathlib import Path
p = Path("tools/bench_train_suite.py"); s = p.read_text()

old = '''    steady = windows[1:] if len(windows) > 1 else windows
    sps = sorted(steady)[len(steady) // 2] if steady else 0.0
    return {"game": game, "sps": round(sps), "windows": [round(w)
            for w in windows], "minutes": round((time.time() - t0) / 60, 1)}'''
new = '''    steady = windows[1:] if len(windows) > 1 else windows
    sps = sorted(steady)[len(steady) // 2] if steady else 0.0
    row = {"game": game, "sps": round(sps), "windows": [round(w)
           for w in windows], "minutes": round((time.time() - t0) / 60, 1)}
    if not steady:
        # No throughput window was ever parsed: the run stalled or died rather
        # than ran slowly. Flag it, because "sps 0" reads like a measurement and
        # a reader skimming a geomean will not notice the games_ok count.
        # Seen in practice: the second DDP learner intermittently fails to take
        # its GPU under MPS (cudaErrorDevicesUnavailable in ddp_learner), the
        # run hangs, and no stats are emitted.
        row["failed"] = True
        row["error"] = f"no sps windows parsed - see suite_logs/{game}.log"
        print(f"  [{game}] *** FAILED: no sps windows parsed ***", flush=True)
    return row'''
assert s.count(old) == 1, "bench_game tail"
s = s.replace(old, new)

old = '''    ok = [r["sps"] for r in rows if r.get("sps", 0) > 0]'''
new = '''    failed = [r["game"] for r in rows if r.get("sps", 0) <= 0]
    ok = [r["sps"] for r in rows if r.get("sps", 0) > 0]'''
assert s.count(old) == 1, "ok list"
s = s.replace(old, new)

old = '''        "games_ok": len(ok), "games_total": len(rows),'''
new = '''        "games_ok": len(ok), "games_total": len(rows),
        "games_failed": failed,'''
assert s.count(old) == 1, "summary"
s = s.replace(old, new)

old = '''    print(f"\\nMEAN {summary['mean_sps']:,}  GEOMEAN {summary['geomean_sps']:,}"
          f"  ({summary['games_ok']}/{summary['games_total']} games)")
    print(f"wrote {args.out}")'''
new = '''    print(f"\\nMEAN {summary['mean_sps']:,}  GEOMEAN {summary['geomean_sps']:,}"
          f"  ({summary['games_ok']}/{summary['games_total']} games)")
    if failed:
        # Loud, because the geomean above is over the SURVIVORS only and looks
        # perfectly healthy either way.
        print("*" * 68)
        print(f"*** {len(failed)} GAME(S) FAILED and are EXCLUDED from the "
              f"numbers above: {', '.join(failed)}")
        print(f"*** The geomean covers {summary['games_ok']} of "
              f"{summary['games_total']} games. Re-run the failures before "
              f"quoting it as a suite result.")
        print("*" * 68)
    print(f"wrote {args.out}")'''
assert s.count(old) == 1, "print tail"
s = s.replace(old, new)

p.write_text(s)
print("patched bench_train_suite.py")
