"""Compare the Table 1 and double-buffering steps' output with the paper's cells.

    python tools/check_table1.py t1a  < output of t1a_agg.py
    python tools/check_table1.py t1b  < output of tab1b.py
    python tools/check_table1.py dbuf < output of dbuf_tex2.py
"""
import re
import sys
from pathlib import Path

EXPECTED = Path(__file__).resolve().parents[2] / "expected" / "tables"


def fmt(v):
    return f"{v / 1e6:.2f}M" if v >= 1e6 else f"{round(v / 1e3)}k"


def main():
    kind, text = sys.argv[1], sys.stdin.read()
    sys.stdout.write(text)
    got, want = {}, {}
    if kind == "t1a":
        # the paper's Table 1(a): the t3fix rows (the published engine)
        want = {"impala_nature ALL24": "1.07M", "impala_icnn ALL24": "0.35M", "ppo_nature ALL24": "185k",
                "ppo_impala ALL24": "68k", "impala_nature ProcGen16": "1.06M", "impala_nature ALE8": "1.09M"}
        for line in text.splitlines():
            m = re.match(r"(\w+)\s+24\s+t3fix\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)", line)
            if m:
                row = m.group(1)
                a, p, e = (int(x.replace(",", "")) for x in m.groups()[1:])
                # the paper prints the IMPALA-CNN row in millions (0.35M)
                got[f"{row} ALL24"] = f"{a / 1e6:.2f}M" if row == "impala_icnn" else fmt(a)
                got[f"{row} ProcGen16"], got[f"{row} ALE8"] = fmt(p), fmt(e)
    elif kind == "t1b":
        want = {"ProcGen envpool": "372k", "ProcGen tier3": "838k", "ALE envpool": "175k", "ALE tier3": "1018k"}
        suite = None
        for line in text.splitlines():
            if line.rstrip(":") in ("ProcGen", "ALE"):
                suite = line.rstrip(":")
            m = re.match(r"\s+(envpool|tier3)\s+([\d,]+)", line)
            if m and suite:
                got[f"{suite} {m.group(1)}"] = f"{round(int(m.group(2).replace(',', '')) / 1e3)}k"
    elif kind == "dbuf":
        norm = lambda s: re.sub(r"\s+", " ", s.strip())
        paper = [norm(l) for l in (EXPECTED / "tab_dbuf_rows.tex").read_text().splitlines() if "&" in l]
        out = {norm(l) for l in text.splitlines() if "&" in l}
        miss = [r for r in paper if r not in out]
        print(f"    {len(paper) - len(miss)} of {len(paper)} rows identical to the paper's")
        return 1 if miss else 0
    bad = [k for k in want if got.get(k) != want[k]]
    for k in want:
        print(f"    {k:26s} {got.get(k, '-'):>7}   paper {want[k]:>7}   {'match' if k not in bad else 'DIFFERS'}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
