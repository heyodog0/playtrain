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
  userAgent            browser + OS fingerprint
  source.study/session Prolific study and session ids
  completionCode       Prolific completion code
  consent.at,          absolute timestamps; cross-referenceable against Prolific
  startedAt, finishedAt, feedback.at
  consent.doNotRecontact  operational, not scientific
  feedback free text   technicalIssues, confusingParts, suggestions

What is transformed
  filename, participantId value -> p01..pNN, assigned by session start order
  startedAt, finishedAt   -> truncated to the minute (the study filter needs them)
  consent.at, feedback.at -> durations in seconds, relative to session start
  demographics.age        -> a 10-year band

What is kept, verbatim
  order, blocks (every episode: game, seed, frames, score, return, terminal
  flags, the full action and key traces), quiz, preflight, screen,
  feedback.technicalIssueLevel, gender / gaming experience / gaming frequency,
  partial.

The free-text answers were read in full and contain no identifying information,
but nothing in the analysis reads them, so they are dropped rather than
published. The categorical technicalIssueLevel is kept, since it is the field
that says whether a session hit problems.
"""
from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime
from pathlib import Path

DROP_TOP = ("userAgent", "completionCode", "source")


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
    # startedAt is load-bearing: the study's own analysis filters on it to drop the
    # pilot sessions, so it cannot be removed. Truncate to the minute, which keeps
    # that boundary exact and drops the sub-minute precision.
    for k in ("startedAt", "finishedAt"):
        if isinstance(out.get(k), str) and len(out[k]) >= 16:
            out[k] = out[k][:17] + "00.000Z"
    # Keep the field NAME: the downstream study tooling reads participantId, and
    # only the value was ever identifying.
    out["participantId"] = pid
    out["sessionSeconds"] = offset(raw.get("finishedAt"))

    if isinstance(out.get("consent"), dict):
        consent = dict(out["consent"])
        consent.pop("doNotRecontact", None)
        consent["atSeconds"] = offset(consent.pop("at", None))
        out["consent"] = consent

    if isinstance(out.get("feedback"), dict):
        feedback = dict(out["feedback"])
        feedback["atSeconds"] = offset(feedback.pop("at", None))
        # Free text is dropped. It carries no identifiers and no analysis reads it,
        # so publishing it is risk without purpose.
        for key in ("technicalIssues", "confusingParts", "suggestions"):
            feedback.pop(key, None)
        out["feedback"] = feedback

    if isinstance(out.get("demographics"), dict):
        demo = dict(out["demographics"])
        band = _age_band(demo.pop("age", None))
        if band:
            demo["ageBand"] = band
        out["demographics"] = demo

    return {"participantId": pid, **{k: v for k, v in out.items() if k != "participantId"}}


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
