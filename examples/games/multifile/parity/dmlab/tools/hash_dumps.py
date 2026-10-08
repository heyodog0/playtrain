"""Write the sha256 of every committed oracle dump into manifest.json.

    uv run --no-sync python tools/hash_dumps.py
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def main():
    man = json.loads((HERE / 'manifest.json').read_text())
    dumps = {}
    for d in sorted((HERE / 'reference' / 'dumps').iterdir()):
        if d.is_dir():
            files = sorted(d.glob('*.json'), key=lambda p: int(p.stem))
            dumps[d.name] = {p.stem: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    man['reference']['dumps'] = dumps
    (HERE / 'manifest.json').write_text(json.dumps(man, indent=2) + '\n')
    print({k: len(v) for k, v in dumps.items()})


if __name__ == '__main__':
    main()
