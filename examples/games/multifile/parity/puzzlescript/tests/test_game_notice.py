"""games/NOTICE.md lists every game text with its current sha256 and is what tools/game_notice.py generates."""
import hashlib
import re
import subprocess
import sys

from conftest import FAMILY

NOTICE = FAMILY / "games" / "NOTICE.md"


def test_notice_is_fresh():
    proc = subprocess.run([sys.executable, str(FAMILY / "tools" / "game_notice.py"), "--check"], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_every_game_text_listed_with_its_sha256():
    text = NOTICE.read_text()
    listed = {m.group(1): m.group(2) for m in re.finditer(r"^\| ([a-z0-9_]+) \| .*? \| ([0-9a-f]{64}) \|", text, re.M)}
    files = sorted(p.stem for p in (FAMILY / "games").glob("*.txt"))
    assert files and set(files) == set(listed), set(files) ^ set(listed)
    for f in files:
        assert hashlib.sha256((FAMILY / "games" / f"{f}.txt").read_bytes()).hexdigest() == listed[f], f
    assert "MIT" in text and "dropdown" in text
