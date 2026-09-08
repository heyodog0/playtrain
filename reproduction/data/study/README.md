# Human baseline study — anonymized sessions

30 participants, one file each (`p01.json` … `p30.json`), recruited via Prolific
on 2026-08-05. Produced from the raw sessions by
[`reproduction/anonymize_study_data.py`](../../anonymize_study_data.py); the raw
files are not published.

Removed before release: the Prolific participant ID, browser user-agent, Prolific
study and session ids, completion code, and all absolute timestamps. Ages are
published as 10-year bands. Participant ids `pNN` are assigned by session start
order and carry no meaning outside this dataset.

Kept verbatim: every episode — game, seed, frame count, score, return, terminal
flags, and the full action and key traces — plus the comprehension quiz, the
display preflight, screen geometry, free-text feedback, gender, and self-reported
gaming experience and frequency.

Each session is 8 blocks of a game, 4–5 episodes per block. The action traces are
what make a session replayable: `tools/verify-replay.mjs` steps them back through
the headless runtime and checks the score matches, which is the evidence that
participants and agents played identical tasks.

The free-text responses were read in full before release and contain no
identifying information. They are published unedited.
