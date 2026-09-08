"""Emit tab:llm-cost from the generation logs.

Every column except LoC and SPS is derived here: call count and wall-clock come
from the logs themselves, token counts from the Gemini count_tokens endpoint
over the exact prompt and raw_output strings each log stored, and cost from the
published Gemini 3.1 Pro rates.

Writes a JSON beside the LaTeX so the numbers in the paper stay checkable
without a second API call -- the earlier version printed to stdout only, which
is why the table had no provenance.

usage:
  GEMINI_API_KEY=... uv run --with google-genai python -m playtrain.gen.count_tokens
  ... --out reproduction/data/llm_cost.json
"""
import argparse
import glob
import json
import os
import pathlib

from google import genai

# Gemini 3.1 Pro list price, USD per 1M tokens.
RATE_IN, RATE_OUT = 2.0, 12.0

# The generation logs moved under reproduction/ for the release; they are paper
# data, not runtime. Override with $PLAYTRAIN_GEN_LOGS.
BASE = os.environ.get('PLAYTRAIN_GEN_LOGS') or str(
    pathlib.Path(__file__).resolve().parents[3] / 'reproduction' / 'data' / 'generation-logs')
BASE = BASE.rstrip('/') + '/'

# qbert.v2 took two calls under two names: the variant that produced v1 and the
# one that produced v2 from it.
ARTIFACTS = {
    'breakout.multi': ['*breakout.multi*'],
    'qbert.v2': ['*qbert.v1_variant*', '*qbert.v2*'],
    'flappy_bird.dunk2': ['*flappy_bird.dunk2*'],
    'frostbite.jungle': ['*frostbite.jungle*'],
    'vvvvvv': ['*vvvvvv*'],
    'downwell_fresh': ['*downwell_fresh*'],
}

# Measured elsewhere, carried here so the table has a single source.
# LoC is the diff against the parent game, or the file length when the game is
# new; SPS is single-core throughput on the suite's full-node configuration.
EXTRA = {
    'breakout.multi': (r'$\sim$140', '355k'),
    'qbert.v2': (r'$\sim$290', '39k'),
    'flappy_bird.dunk2': (r'$\sim$80', '354k'),
    'frostbite.jungle': (r'$\sim$300', '239k'),
    'vvvvvv': ('258 (new)', '356k'),
    'downwell_fresh': ('419 (new)', '354k'),
}


def ntok(client, model, text):
    if not text:
        return 0
    last = None
    for m in (model, "gemini-2.5-pro", "gemini-2.5-flash"):
        try:
            return client.models.count_tokens(model=m, contents=text).total_tokens
        except Exception as e:  # the preview id may be retired; fall back
            last = e
    # Report why. Swallowing this hid a 403 on a key whose project never had
    # the Gemini API enabled, which looked identical to a retired model id.
    raise RuntimeError(f"count_tokens failed on every model: {last}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='reproduction/data/llm_cost.json')
    ap.add_argument('--tex', default='reproduction/data/tab_llm_cost.tex')
    args = ap.parse_args()

    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise SystemExit("set GEMINI_API_KEY or GOOGLE_API_KEY")
    client = genai.Client(api_key=key)
    rows, missing = [], []

    for name, pats in ARTIFACTS.items():
        files = sorted(set(sum([glob.glob(BASE + p) for p in pats], [])))
        if not files:
            missing.append(name)
            continue
        tin = tout = 0
        secs = 0.0
        for f in files:
            d = json.load(open(f))
            tin += ntok(client, d.get("model"), d.get("prompt", ""))
            tout += ntok(client, d.get("model"), d.get("raw_output", ""))
            secs += float(d.get("duration_s") or 0.0)
        rows.append({
            'artifact': name,
            'calls': len(files),
            'tokens_in': tin,
            'tokens_out': tout,
            'minutes': round(secs / 60, 1),
            'cost_usd': round(tin / 1e6 * RATE_IN + tout / 1e6 * RATE_OUT, 2),
            'files': [os.path.basename(f) for f in files],
        })

    total = {k: sum(r[k] for r in rows)
             for k in ('calls', 'tokens_in', 'tokens_out')}
    total['minutes'] = round(sum(r['minutes'] for r in rows), 1)
    # From the token totals, not the sum of already-rounded rows -- six rows
    # each rounded up to the cent add a spurious penny.
    total['cost_usd'] = round(total['tokens_in'] / 1e6 * RATE_IN
                              + total['tokens_out'] / 1e6 * RATE_OUT, 2)

    pathlib.Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    json.dump({'rows': rows, 'total': total, 'rate_in': RATE_IN,
               'rate_out': RATE_OUT, 'missing': missing},
              open(args.out, 'w'), indent=1)

    L = [r'\begin{tabular}{lrrrrrr}', r'\toprule',
         r'Artifact & Calls & Tokens (in / out) & Time & Cost & LoC $\Delta$ & SPS \\',
         r'\midrule']
    for r in rows:
        loc, sps = EXTRA.get(r['artifact'], ('---', '---'))
        L.append(f"{r['artifact'].replace('_', chr(92) + '_')} & {r['calls']} & "
                 f"{r['tokens_in']:,} / {r['tokens_out']:,} & "
                 f"{r['minutes']} min & \\${r['cost_usd']:.2f} & {loc} & {sps} " + r'\\')
    L += [r'\midrule',
          f"Total & {total['calls']} & {total['tokens_in']:,} / "
          f"{total['tokens_out']:,} & {total['minutes']} min & "
          f"\\${total['cost_usd']:.2f} & --- & --- " + r'\\',
          r'\bottomrule', r'\end{tabular}']
    open(args.tex, 'w').write('\n'.join(L).replace(',', '{,}') + '\n')

    print('\n'.join(L))
    if missing:
        print('MISSING LOGS:', missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
