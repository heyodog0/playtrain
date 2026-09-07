#!/usr/bin/env python3
"""Regenerate the clip galleries in index.html from what is in rollouts/.

Clip files are named `<game>__<trainer>.gif` under rollouts/agent, and `<game>.gif`
under rollouts/human. rollouts/scores.json carries, per game, a block per trainer
with its greedy mean return, plus the human score where a recording exists.

Three marker-delimited blocks are generated:

  TEASER   the header strip, the stronger policy per game
  COMPARE  human vs IMPALA vs PPO, for games the study covered
  GALLERY  every game, both trainers side by side, greedy scores, winner marked

Greedy mean return is the comparison metric throughout: the trainers' TensorBoard
returns come from their sampled behaviour policies and are not comparable to each
other, nor to what an argmax clip shows.
"""
from __future__ import annotations

import html
import json
import pathlib
import re

HERE = pathlib.Path(__file__).parent
INDEX = HERE / "index.html"
AGENT = HERE / "rollouts" / "agent"
HUMAN = HERE / "rollouts" / "human"
SCORES = HERE / "rollouts" / "scores.json"

TRAINERS = ("impala", "ppo")
# The header set, chosen by hand. Both trainers are shown per game for now so
# one can be picked per game later; TEASER_PICK is that choice once made.
TEASER_ORDER = ["coinrun", "qbert.v2", "breakout.multi", "frostbite.jungle",
                "downwell_fresh", "miner", "starpilot", "bossfight"]
TEASER_PICK: dict[str, str] = {}     # e.g. {"coinrun": "impala"}


def clips() -> dict[str, dict[str, str]]:
    """{game: {trainer: filename}} from what is on disk.

    Scans mp4 as well as gif: the page prefers mp4, and newer clips ship as mp4
    only, so globbing gif alone silently dropped them. A gif is recorded only
    when no mp4 sits beside it.
    """
    found: dict[str, dict[str, str]] = {}
    for ext in ("*.mp4", "*.gif"):
        for path in sorted(AGENT.glob(ext)):
            game, _, trainer = path.stem.partition("__")
            slot = found.setdefault(game, {})
            slot.setdefault(trainer or "agent", path.name)
    return found


def human_clips() -> dict[str, str]:
    return {p.stem: p.name for p in sorted(HUMAN.glob("*.gif"))} if HUMAN.is_dir() else {}


def num(value) -> str:
    if not isinstance(value, (int, float)):
        return ""
    return f"{value:,.0f}" if abs(value) >= 100 else f"{value:g}"


def better(scores: dict, game: str) -> str | None:
    """Which trainer has the higher greedy mean on this game."""
    side = scores.get(game, {})
    have = {t: side[t]["greedy_return_mean"] for t in TRAINERS
            if isinstance(side.get(t), dict)
            and isinstance(side[t].get("greedy_return_mean"), (int, float))}
    if len(have) < 2:
        return next(iter(have), None)
    ranked = sorted(have.items(), key=lambda kv: -kv[1])
    if ranked[0][1] == ranked[1][1]:
        return None                       # a tie marks neither side
    return ranked[0][0]


def figure(src: str, alt: str, caption: str, cls: str = "") -> str:
    """One clip. Uses <video> when an mp4 sits beside the gif.

    Safari would not animate the GIFs (the files are valid and Chrome played
    them), while a muted inline autoplay video is reliable there and, unlike an
    animated image, its playback is observable from script. The gif stays as the
    fallback for anything that cannot play h264.
    """
    cls = f' class="{cls}"' if cls else ""
    mp4 = re.sub(r"\.gif$", ".mp4", src)
    if (HERE / mp4).exists():
        media = (f'<video src="{mp4}" autoplay loop muted playsinline preload="metadata" '
                 f'aria-label="{html.escape(alt)}"></video>')
    else:
        media = f'<img src="{src}" alt="{html.escape(alt)}" loading="lazy">'
    return f'<figure{cls}>{media}<figcaption>{caption}</figcaption></figure>'


def build_teaser(found, scores) -> str:
    """The header strip.

    While TEASER_PICK is empty every game shows both trainers side by side, with
    their greedy means, so a choice can be made from the page itself. Naming a
    trainer for a game in TEASER_PICK collapses it to that one clip.
    """
    picks = [g for g in TEASER_ORDER if g in found]
    cards = []
    for game in picks:
        side = scores.get(game, {})
        win = better(scores, game)
        chosen = TEASER_PICK.get(game)
        cells = []
        for trainer in TRAINERS:
            if chosen and trainer != chosen:
                continue
            name = found[game].get(trainer)
            if not name:
                continue
            info = side.get(trainer) or {}
            mark = " is-best" if trainer == win and not chosen else ""
            cells.append('          ' + figure(
                f"rollouts/agent/{name}",
                f"A {trainer.upper()} agent playing the {game} environment.",
                f"{trainer}<small>{num(info.get('greedy_return_mean'))}</small>",
                f"is-agent{mark}"))
        if not cells:
            continue
        cards.append('      <div class="pair">\n'
                     f'        <h3>{html.escape(game)}</h3>\n'
                     '        <div class="pair-clips">\n'
                     + "\n".join(cells) + "\n        </div>\n      </div>")
    return '    <div class="pair-grid is-wide is-teaser">\n' + "\n".join(cards) + "\n    </div>"


def build_compare(found, humans, scores) -> str:
    cards = []
    for game in sorted(humans):
        if game not in found:
            continue
        side = scores.get(game, {})
        win = better(scores, game)
        parts = ['          ' + figure(
            f"rollouts/human/{humans[game]}",
            f"A person playing the {game} environment.",
            f"human<small>{num(side.get('human_score'))}</small>", "is-human")]
        for trainer in TRAINERS:
            name = found[game].get(trainer)
            if not name:
                continue
            info = side.get(trainer) or {}
            mark = " is-best" if trainer == win else ""
            parts.append('          ' + figure(
                f"rollouts/agent/{name}",
                f"A {trainer.upper()} agent playing the {game} environment.",
                f"{trainer}<small>{num(info.get('greedy_return_mean'))}</small>",
                f"is-agent{mark}"))
        cards.append('      <div class="pair">\n'
                     f'        <h3>{html.escape(game)}</h3>\n'
                     '        <div class="pair-clips">\n'
                     + "\n".join(parts) + "\n        </div>\n      </div>")
    return '    <div class="pair-grid">\n' + "\n".join(cards) + "\n    </div>"


def build_gallery(found, scores) -> str:
    cards = []
    for game in sorted(found):
        side = scores.get(game, {})
        win = better(scores, game)
        cells = []
        for trainer in TRAINERS:
            name = found[game].get(trainer)
            if not name:
                continue
            info = side.get(trainer) or {}
            mark = " is-best" if trainer == win else ""
            cells.append('          ' + figure(
                f"rollouts/agent/{name}",
                f"A {trainer.upper()} agent playing the {game} environment.",
                f"{trainer}<small>{num(info.get('greedy_return_mean'))}</small>",
                f"is-agent{mark}"))
        if not cells:
            continue
        cards.append('      <div class="pair">\n'
                     f'        <h3>{html.escape(game)}</h3>\n'
                     '        <div class="pair-clips">\n'
                     + "\n".join(cells) + "\n        </div>\n      </div>")
    return '    <div class="pair-grid is-wide">\n' + "\n".join(cards) + "\n    </div>"


def replace_block(text: str, name: str, body: str) -> str:
    start, end = f"<!-- {name}:START -->", f"<!-- {name}:END -->"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        raise SystemExit(f"marker {start} ... {end} not found in index.html")
    return pattern.sub(f"{start}\n{body}\n    {end}", text)


def main() -> None:
    found, humans = clips(), human_clips()
    scores = json.loads(SCORES.read_text()) if SCORES.exists() else {}
    text = INDEX.read_text()
    text = replace_block(text, "TEASER", build_teaser(found, scores))
    text = replace_block(text, "COMPARE", build_compare(found, humans, scores))
    text = replace_block(text, "GALLERY", build_gallery(found, scores))
    INDEX.write_text(text)
    pairs = sum(1 for g in found if len(found[g]) > 1)
    wins = {t: sum(1 for g in found if better(scores, g) == t) for t in TRAINERS}
    print(f"galleries: {len(found)} games, {pairs} with both trainers, "
          f"{len([g for g in humans if g in found])} human pairs; "
          f"greedy wins {wins}")


if __name__ == "__main__":
    main()
