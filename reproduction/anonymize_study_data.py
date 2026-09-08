#!/usr/bin/env python3
"""Turn raw human-study sessions into the public, anonymized release.

The raw files are named by Prolific participant ID and carry identifiers that
must not be published (the ID itself, the browser user-agent, Prolific study /
session ids, the completion code, absolute wall-clock timestamps). This script
is the only path from those files to the release, so the transformation is
auditable even though its input never ships.

    python reproduction/anonymize_study_data.py --in dist/study-data \
                                                --out reproduction/data/study

What is removed
  participantId        Prolific ID; stable across studies, re-identifiable by Prolific
  userAgent            browser + OS fingerprint
  source.study/session Prolific study and session ids
  completionCode       Prolific completion code
  consent.at,          absolute timestamps; cross-referenceable against Prolific
  startedAt, finishedAt, feedback.at
  consent.doNotRecontact  operational, not scientific

What is transformed
  filename, participantId -> p01..pNN, assigned by session start order
  timestamps              -> durations in seconds, relative to session start
  demographics.age        -> a 10-year band

What is kept, verbatim
  order, blocks (every episode: game, seed, frames, score, return, terminal
  flags, the full action and key traces), quiz, preflight, screen, feedback
  free text, gender / gaming experience / gaming frequency, partial.

The free-text responses were read in full before release and contain no
identifying information; they are published unedited.
"""
from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime
from pathlib import Path

DROP_TOP = ("participantId", "userAgent", "completionCode", "startedAt", "finishedAt", "source")


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _age_band(age: object) -> str | None:
    if not isinstance(age, int):
        return None
    low = max(18, (age // 10) * 10)
    return f"{low}-{low + 9}"


def anonymize(raw: dict, pid: str) -> dict:
    start = _ts(raw.get("startedAt"))

    def offset(value: str | None) -> float | None:
        t = _ts(value)
        return None if (t is None or start is None) else round((t - start).total_seconds(), 3)

    out = {k: v for k, v in raw.items() if k not in DROP_TOP}
    out["participant"] = pid
    out["sessionSeconds"] = offset(raw.get("finishedAt"))

    if isinstance(out.get("consent"), dict):
        consent = dict(out["consent"])
        consent.pop("doNotRecontact", None)
        consent["atSeconds"] = offset(consent.pop("at", None))
        out["consent"] = consent

    if isinstance(out.get("feedback"), dict):
        feedback = dict(out["feedback"])
        feedback["atSeconds"] = offset(feedback.pop("at", None))
        out["feedback"] = feedback

    if isinstance(out.get("demographics"), dict):
        demo = dict(out["demographics"])
        band = _age_band(demo.pop("age", None))
        if band:
            demo["ageBand"] = band
        out["demographics"] = demo

    return {"participant": pid, **{k: v for k, v in out.items() if k != "participant"}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", default="dist/study-data", type=Path)
    ap.add_argument("--out", dest="dst", default="reproduction/data/study", type=Path)
    args = ap.parse_args()

    files = sorted(args.src.glob("*.json"))
    if not files:
        raise SystemExit(f"no sessions found in {args.src}")

    # Stable ids: session start order, then filename to break ties.
    loaded = sorted(((json.loads(f.read_text()), f) for f in files),
                    key=lambda pair: (pair[0].get("startedAt") or "", pair[1].name))

    args.dst.mkdir(parents=True, exist_ok=True)
    for i, (raw, path) in enumerate(loaded, start=1):
        pid = f"p{i:02d}"
        # gzip: the action traces are 2000 ints per episode, so the set is 6.2 MB
        # of JSON and 0.3 MB compressed. Nobody reads these by eye.
        blob = json.dumps(anonymize(raw, pid), separators=(",", ":")).encode()
        with gzip.open(args.dst / f"{pid}.json.gz", "wb", compresslevel=9) as fh:
            fh.write(blob)

    print(f"wrote {len(loaded)} anonymized sessions to {args.dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
