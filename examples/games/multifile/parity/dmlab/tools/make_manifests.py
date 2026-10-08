"""Write manifest_<level>.json for every compiled level except the one
manifest.json bundles, deriving everything from manifest.json and
tools/compile_level.py LEVELS so the levels cannot drift apart.

    uv run --no-sync python tools/make_manifests.py
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / 'tools'))
from compile_level import LEVELS as EXPLORE  # noqa: E402
from compile_rooms import LEVELS as ROOMS  # noqa: E402

LEVELS = dict(EXPLORE, **ROOMS)

BASE = json.loads((HERE / 'manifest.json').read_text())
FIRST = 'explore_goal_locations_small'


def manifest(level):
    spec = LEVELS[level]
    m = {k: v for k, v in BASE.items() if k not in ('reference', 'note')}
    m['name'] = 'dmlab_' + level
    m['title'] = 'DMLab ' + level
    m['sources'] = [s.replace(f'atlas/{FIRST}.js', f'atlas/{level}.js').replace(f'levels/{FIRST}.js', f'levels/{level}.js')
                    .replace(f'spawn/{FIRST}.js', f'spawn/{level}.js')
                    for s in BASE['sources']]
    m['max_steps'] = spec['seconds'] * 60 // 4
    m['max_steps_source'] = f"episodeLengthSeconds {spec['seconds']} s x 60 fps / action repeat 4"
    r = BASE['reference']
    m['reference'] = {k: r[k] for k in ('name', 'repo', 'commit', 'license', 'parity', 'not_matched')}
    m['reference']['level'] = 'contributed/dmlab30/' + level
    m['reference']['family_pins'] = 'manifest.json (oracle, action set, constants, dump hashes, files read)'
    return m


def main():
    for level in sorted(LEVELS):
        if level == FIRST or not (HERE / 'src' / 'levels' / f'{level}.js').exists():
            continue
        (HERE / f'manifest_{level}.json').write_text(json.dumps(manifest(level), indent=2) + '\n')
        print('manifest_' + level + '.json')


if __name__ == '__main__':
    main()
