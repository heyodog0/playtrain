# Prompts

- `GAME_TEMPLATE.md` — the game contract. Every generation prompt includes it
  verbatim; `src/playtrain/gen/generate.py` reads it from here. It has had small
  additions since the April generation runs, so each logged prompt carries the
  version it was sent with.
- `generate_downwell.txt`, `refine_downwell.txt`, `fork_frostbite_jungle.txt` —
  the generation, refinement and fork prompts as printed in the paper's appendix.
  The refine and fork prompts there omit the game code they carry; the complete
  prompts as sent are in `reproduction/data/generation-logs/`.

The prompt text is assembled in code: generation in `gen/generate.py`
(`build_prompt`), refinement and forking in `gen/refine.py` (`FRAMINGS["fix"]`
and `FRAMINGS["variant"]`; `gen/variant.py` calls refine with the variant framing).
