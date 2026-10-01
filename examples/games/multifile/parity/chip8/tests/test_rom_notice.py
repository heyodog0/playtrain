"""roms/NOTICE.md lists every ROM file in roms/ with its current sha1 and is what tools/rom_notice.py
generates (human decision 2026-09-19: keep the ROMs, add a notice)."""
import hashlib
import re
import subprocess
import sys

from conftest import FAMILY

NOTICE = FAMILY / "roms" / "NOTICE.md"


def test_notice_is_fresh():
    proc = subprocess.run([sys.executable, str(FAMILY / "tools" / "rom_notice.py"), "--check"], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_every_rom_file_listed_with_its_sha1():
    text = NOTICE.read_text()
    listed = {m.group(1): m.group(2) for m in re.finditer(r"^\| ([^|]+\.ch8) \| ([0-9a-f]{40}) \|", text, re.M)}
    files = sorted(p.name for p in (FAMILY / "roms").glob("*.ch8"))
    assert files and set(files) == set(listed), set(files) ^ set(listed)
    for f in files:
        assert hashlib.sha1((FAMILY / "roms" / f).read_bytes()).hexdigest() == listed[f], f
    assert "Octax" in text and "MIT" in text
