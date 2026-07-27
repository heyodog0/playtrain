"""Post-hoc exact token counts for the paper's authored artifacts (tab:llm-cost).

Usage: GEMINI_API_KEY=... .venv/bin/python tools/count_tokens_post.py

The generation logs stored the full prompt and raw output strings; tokenize
them with the Gemini count_tokens endpoint using the logged model (fallback
to a servable sibling if the preview id is gone).
"""
import glob, json, os, sys
from google import genai

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
import pathlib
BASE = str(pathlib.Path(__file__).resolve().parents[3] / 'games' / 'logs') + '/'
ARTIFACTS = {
    'breakout.multi': ['*breakout.multi*'],
    'qbert.v2': ['*qbert.v1_variant*', '*qbert.v2*'],
    'flappy_bird.dunk2': ['*flappy_bird.dunk2*'],
    'frostbite.jungle': ['*frostbite.jungle*'],
    'vvvvvv': ['*vvvvvv*'],
    'downwell_fresh': ['*downwell_fresh*'],
}


def ntok(model, text):
    if not text:
        return 0
    for m in (model, "gemini-2.5-pro", "gemini-2.5-flash"):
        try:
            return client.models.count_tokens(model=m, contents=text).total_tokens
        except Exception:
            continue
    raise RuntimeError("no servable model for count_tokens")


print(f"{'artifact':20s} {'calls':>5s} {'tok_in':>8s} {'tok_out':>8s} {'total':>8s}")
for name, pats in ARTIFACTS.items():
    files = sorted(set(sum([glob.glob(BASE + p) for p in pats], [])))
    tin = tout = 0
    for f in files:
        d = json.load(open(f))
        tin += ntok(d.get("model"), d.get("prompt", ""))
        tout += ntok(d.get("model"), d.get("raw_output", ""))
    print(f"{name:20s} {len(files):5d} {tin:8,d} {tout:8,d} {tin+tout:8,d}")
