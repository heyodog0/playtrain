"""Closed-loop refinement of a generated clone against the REAL Atari ROM.

Each iteration:
  1. Roll the real ROM (ALE) and the current clone on the SAME action sequence,
     sample matched timesteps, and stitch a real-vs-clone comparison image.
  2. Send that comparison + the current clone code to Gemini, asking it to close
     the biggest FEEL/look gaps (not a 1:1 pixel copy).
  3. Write the revised code (auto-backup), then repeat — so the clone converges
     on the real game over N iterations.

Requires: ale-py + the game ROM (AutoROM), GEMINI_API_KEY, sibling PlayTrain repo.
Usage:  uv run python tools/refine_vs_rom.py --game beam_rider --iters 3
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import ale_py
import gymnasium as gym
from PIL import Image, ImageDraw
from google import genai
from google.genai import types

# Reuse helpers from the generator (importing does not run its main()).
from generate import strip_fences, backup_game, MODELS

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = ROOT / "GAME_TEMPLATE.md"
JS_DIR = ROOT / "games" / "js"
OUT_DIR = ROOT / "outputs" / "refine_vs_rom"
NODE_HELPER = ROOT / "tools" / "render_clone_frames.mjs"

gym.register_envs(ale_py)

RES = 400
DEFAULT_STEPS = 500
DEFAULT_TICKS = [120, 240, 360, 480]

# Shared "intent" policy → mapped into each game's own action indices so the real
# ROM and the clone are driven by the same behavior (fire + weave).
ALE_MAP = {"noop": 0, "fire": 1, "right_fire": 7, "left_fire": 8}
# clone Discrete(8): 0 NOOP,1 LEFT,2 RIGHT,3 UP,4 DOWN,5 D,6 LEFT+D,7 RIGHT+D
CLONE_MAP = {"noop": 0, "fire": 5, "right_fire": 7, "left_fire": 6}


def intent(t: int) -> str:
    if t < 30:
        return "fire"
    return ["right_fire", "fire", "left_fire", "fire"][(t // 20) % 4]


def build_actions(steps: int):
    intents = [intent(t) for t in range(steps)]
    return [ALE_MAP[i] for i in intents], [CLONE_MAP[i] for i in intents]


def ensure_rom(name: str):
    """Make sure ale-py can find <name>.bin, copying it from AutoROM if needed."""
    import shutil
    dest = Path(ale_py.__file__).parent / "roms" / f"{name}.bin"
    if dest.exists():
        return
    try:
        import AutoROM
        src = Path(AutoROM.__file__).parent / "roms" / f"{name}.bin"
        if src.exists():
            shutil.copy(src, dest)
            print(f"provisioned ROM {name}.bin into ale-py")
        else:
            print(f"note: {name}.bin not found in AutoROM — run: uv run --extra rom AutoROM --accept-license")
    except Exception as e:
        print(f"note: could not auto-provision ROM ({e})")


def ale_id_for(name: str, override: str | None) -> str:
    if override:
        return override
    camel = "".join(p.capitalize() for p in name.split("_"))
    return f"ALE/{camel}-v5"


def capture_real(ale_id, seed, steps, ale_actions, ticks):
    env = gym.make(ale_id, render_mode="rgb_array", frameskip=1, repeat_action_probability=0.0)
    env.reset(seed=seed)
    frames = {}
    for t in range(steps):
        obs, _, term, trunc, _ = env.step(ale_actions[t])
        if t in ticks:
            frames[t] = Image.fromarray(obs)
        if term or trunc:
            env.reset(seed=seed)
    env.close()
    return frames


def capture_clone(game_path, seed, clone_actions, ticks, work_dir):
    cfg = {"gamePath": str(game_path), "outDir": str(work_dir), "seed": seed,
           "res": RES, "ticks": ticks, "actions": clone_actions}
    cfg_path = work_dir / "clone_cfg.json"
    cfg_path.write_text(json.dumps(cfg))
    r = subprocess.run(["node", str(NODE_HELPER), str(cfg_path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"clone render failed:\n{r.stderr}")
    return {t: Image.open(work_dir / f"clone_f{t}.png") for t in ticks}


def measure_motion(frames, ticks):
    """Avg fraction (0..1) of per-pixel brightness change between consecutive
    frames (t -> t+1). A resolution-independent proxy for 'how much moves per
    frame' — lets us compare the clone's motion to the real game's numerically."""
    import numpy as np
    vals = []
    for t in ticks:
        if t in frames and (t + 1) in frames:
            a = np.asarray(frames[t].convert("L"), dtype=np.float32)
            b = np.asarray(frames[t + 1].convert("L"), dtype=np.float32)
            vals.append(float(np.mean(np.abs(b - a)) / 255.0))
    return sum(vals) / len(vals) if vals else 0.0


def build_compare(real, clone, ticks, out_path, label):
    TILE = (300, 360)
    cols, pad, lab = len(ticks), 6, 22
    W = cols * TILE[0] + (cols + 1) * pad
    H = 2 * TILE[1] + 3 * pad + 2 * lab
    canvas = Image.new("RGB", (W, H), (15, 15, 18))
    d = ImageDraw.Draw(canvas)

    def place(img, r, c):
        x = pad + c * (TILE[0] + pad)
        y = pad + lab + r * (TILE[1] + pad + lab)
        canvas.paste(img.convert("RGB").resize(TILE, Image.NEAREST), (x, y))
        return x, y

    d.text((pad, 2), f"REAL ROM (ground truth)   [{label}]", fill=(120, 220, 120))
    for c, t in enumerate(ticks):
        x, y = place(real[t], 0, c)
        d.text((x, y - lab + 2), f"t={t}", fill=(180, 180, 180))
    rowy = pad + lab + TILE[1] + pad
    d.text((pad, rowy - lab + 2), "CLONE (current)", fill=(220, 180, 120))
    for c, t in enumerate(ticks):
        x, y = place(clone[t], 1, c)
        d.text((x, y - lab + 2), f"t={t}", fill=(180, 180, 180))
    canvas.save(out_path)


REFINE_PROMPT = """You are improving a p5.js clone of the Atari game "{name}" so it FEELS more like the real game.

The attached image compares them on the SAME action sequence at matched timesteps:
- TOP row  = the REAL game (ground truth).
- BOTTOM row = the current clone.
{priority_block}
GOAL: make the clone recognizably similar in look and FEEL to the real game. The user wants it "a bit similar", NOT a pixel-perfect 1:1 copy. Prioritize the BIG differences that matter for feel, in roughly this order:
1. MOTION / animation — does the world move/scroll the way the real one does? Compare how elements shift across t=120 -> t=480. This is the most important and easiest to miss.
2. Dominant visual structure — which lines/shapes dominate, background color, presence of things like a starfield.
3. Player appearance and how/where it moves.
4. Colors and proportions.

Do NOT over-fit to exact pixels, exact positions, enemy counts, or the HUD. Do NOT copy the score/text HUD (the agent can't read text). Keep the game fun and learnable, keep the seeded determinism, and preserve the existing core mechanics.

Use ONLY these p5.js drawing functions (the headless runtime supports these): background, fill, noFill, stroke, noStroke, strokeWeight, color, rect, rectMode, ellipse, ellipseMode, circle, triangle, quad, line, push, pop, translate, rotate, scale, beginShape, vertex, endShape, text, textSize, textAlign. Do NOT use images, gradients, DOM, or other p5 APIs.

Current clone code:
```javascript
{code}
```

The game MUST still conform to this template specification:
{template}

Make targeted changes to close the biggest feel/look gaps you SEE in the comparison image. Output ONLY the full revised JavaScript code. No markdown fences, no explanation."""


def main():
    ap = argparse.ArgumentParser(description="Refine a clone against the real Atari ROM")
    ap.add_argument("--game", required=True, help="game name (matches games/js/<name>.js)")
    ap.add_argument("--iters", type=int, default=3)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--steps", type=int, default=DEFAULT_STEPS)
    ap.add_argument("--ale-id", default=None, help="override ALE env id, e.g. ALE/BeamRider-v5")
    ap.add_argument("--model", choices=["flash", "pro"], default="pro")
    ap.add_argument("--feedback", default="", help="free-text feedback fed to the critic as top priority, e.g. 'movement too fast; match the grid lines'")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: set GEMINI_API_KEY (or GOOGLE_API_KEY)")
        raise SystemExit(1)

    game_path = JS_DIR / f"{args.game}.js"
    if not game_path.exists():
        print(f"Error: {game_path} not found — generate the clone first")
        raise SystemExit(1)

    ensure_rom(args.game)
    ale_id = ale_id_for(args.game, args.ale_id)
    ticks = [t for t in DEFAULT_TICKS if t < args.steps]
    # Also grab t+1 at each tick so we can measure per-frame motion.
    motion_ticks = sorted(set(ticks) | {t + 1 for t in ticks if t + 1 < args.steps})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work_dir = OUT_DIR / f"_work_{args.game}"
    work_dir.mkdir(exist_ok=True)

    client = genai.Client(api_key=api_key)
    model = MODELS[args.model]
    template = TEMPLATE_PATH.read_text()

    print(f"Real ROM: {ale_id} | clone: {game_path.name} | iters={args.iters} | ticks={ticks}")
    ale_actions, clone_actions = build_actions(args.steps)

    # The real ROM never changes across iterations — capture it once.
    print("Capturing real ROM frames...")
    real = capture_real(ale_id, args.seed, args.steps, ale_actions, motion_ticks)
    real_motion = measure_motion(real, ticks)

    def revise(prompt_text, img_bytes):
        contents = [types.Part.from_bytes(data=img_bytes, mime_type="image/png"), prompt_text]
        resp = client.models.generate_content(model=model, contents=contents)
        return strip_fences(resp.text)

    def renders_ok():
        """Try to render the current clone; return (ok, error_str)."""
        try:
            capture_clone(game_path, args.seed, clone_actions, motion_ticks, work_dir)
            return True, None
        except RuntimeError as e:
            return False, str(e)

    def priority_block(clone_frames):
        parts = []
        if args.feedback:
            parts.append(f"USER FEEDBACK (HIGHEST PRIORITY — fix this first): {args.feedback}")
        cm = measure_motion(clone_frames, ticks)
        if real_motion > 0 and cm > 0:
            ratio = cm / real_motion
            if ratio > 3:
                speed = "MUCH too fast — reduce per-frame motion (enemy/scroll/projectile speeds) substantially"
            elif ratio > 1.4:
                speed = f"~{ratio:.1f}x too fast — slow it down"
            elif ratio < 0.33:
                speed = "much too slow — speed the clone up substantially"
            elif ratio < 0.7:
                speed = f"~{1/ratio:.1f}x too slow — speed it up"
            else:
                speed = "about right — keep the pace"
            parts.append(
                f"MEASURED MOTION (avg per-frame on-screen change): the clone is {speed}. "
                "The real Atari game moves gently per frame; avoid fast-zooming enemies or a fast-scrolling grid."
            )
        return ("\n" + "\n".join(parts) + "\n") if parts else ""

    for i in range(args.iters):
        # The on-disk clone is always known-good here (rollback guarantees it).
        clone = capture_clone(game_path, args.seed, clone_actions, motion_ticks, work_dir)
        compare_path = OUT_DIR / f"{args.game}_iter{i}.png"
        build_compare(real, clone, ticks, compare_path, f"before iter {i}")
        print(f"iter {i}: comparison -> {compare_path}")

        prev_code = game_path.read_text()  # last-good, for rollback
        img_bytes = compare_path.read_bytes()
        prompt = REFINE_PROMPT.format(name=args.game, code=prev_code, template=template,
                                      priority_block=priority_block(clone))
        try:
            new_code = revise(prompt, img_bytes)
        except Exception as e:
            print(f"iter {i}: Gemini call FAILED: {e}")
            break

        backup_game(args.game, JS_DIR)
        game_path.write_text(new_code)
        ok, err = renders_ok()

        if not ok:
            # One retry: feed the runtime error back so Gemini can self-correct.
            print(f"iter {i}: revision failed to render, retrying with error feedback...")
            retry_prompt = prompt + (
                f"\n\nYOUR PREVIOUS OUTPUT FAILED TO RUN in the headless runtime with:\n{err[:800]}\n"
                "Fix this and use ONLY the supported p5 functions listed above. Output the full corrected code."
            )
            try:
                new_code = revise(retry_prompt, img_bytes)
                game_path.write_text(new_code)
                ok, err = renders_ok()
            except Exception as e:
                ok, err = False, str(e)

        if ok:
            print(f"iter {i}: revised clone written and renders OK ({len(new_code)} bytes)")
        else:
            game_path.write_text(prev_code)  # roll back to last-good
            print(f"iter {i}: revision still broken, rolled back to previous version.\n  ({err[:200]})")

    # Final comparison after the last refine.
    clone = capture_clone(game_path, args.seed, clone_actions, ticks, work_dir)
    final_path = OUT_DIR / f"{args.game}_final.png"
    build_compare(real, clone, ticks, final_path, "final")
    print(f"done. final comparison -> {final_path}")


if __name__ == "__main__":
    main()
