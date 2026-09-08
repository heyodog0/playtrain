"""Targeted game refinement via Gemini.

Refines generated p5.js games by patching only the most relevant code chunks
when possible, with full-file regeneration as a fallback.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import threading
import time
from pathlib import Path

from google import genai

from playtrain._paths import repo_root as _repo_root
ROOT = _repo_root() or Path.cwd()
GAMES_DIR = ROOT / "games"
JS_DIR = GAMES_DIR / "js"
LOG_DIR = GAMES_DIR / "logs"

MODELS = {
    "flash": "gemini-3-flash-preview",
    "pro": "gemini-3.1-pro-preview",
}

CLIENT = None

REQUIRED_FUNCTIONS = ["setup", "draw", "getGameState", "resetGame", "mulberry32"]

REFINE_RULES = """Critical requirements:
- Keep the file as plain JavaScript for p5.js. No imports, no modules.
- Preserve these required functions: setup, draw, getGameState, resetGame, mulberry32.
- Keep deterministic reset behavior via rng = mulberry32(seed) in resetGame.
- Keep score, lives, and gameState consistent with getGameState().
- Keep the runtime-compatible control pattern using keyIsDown(...) / keyPressed() as needed.
- Do not change the file into TypeScript or add markdown fences/explanations.
- Return valid JavaScript only when asked for code, and valid JSON only when asked for JSON.
"""

# Task framing. The contract (REFINE_RULES) is identical for both intents; only
# the framing differs. "fix" treats the instruction as feedback to address with
# minimal disturbance; "variant" treats it as a deliberate transformation the
# model should implement boldly, changing mechanics as needed. The "fix" strings
# reproduce the original prompts verbatim (backward compatible).
FRAMINGS = {
    "fix": {
        "label": "Player feedback",
        "select_intro": "You are selecting the smallest set of code chunks to edit in a p5.js game.",
        "select_tail": (
            "Choose \"rewrite\" if the feedback likely requires coordinated changes across most of the file.\n"
            "Prefer the minimal patch set otherwise."
        ),
        "patch_intro": "You are patching selected chunks in a p5.js game.",
        "rewrite_task": "Rewrite the full file to address the feedback while preserving compatibility.",
    },
    "variant": {
        "label": "Requested variant",
        "select_intro": "You are selecting which code chunks to edit to turn a p5.js game into a new variant.",
        "select_tail": (
            "This is a deliberate design change, not a bug fix. Choose \"rewrite\" if the variant needs "
            "coordinated changes across the file (new mechanics usually do); otherwise prefer the minimal patch set."
        ),
        "patch_intro": "You are patching selected chunks to turn a p5.js game into a new variant.",
        "rewrite_task": (
            "Rewrite the full file to implement this variant. You may freely change the mechanics, rules, "
            "entities, visuals, and difficulty to realize it — only the technical contract below (required "
            "functions, the default Discrete(8) control mapping, seeded determinism, getGameState) "
            "must stay intact."
        ),
    },
}


def mask_api_key(value: str | None) -> str:
    if not value:
        return "<missing>"
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def get_client():
    global CLIENT
    if CLIENT is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("Warning: GEMINI_API_KEY not set, refinement will fail")
            return None
        google_api_key = os.environ.pop("GOOGLE_API_KEY", None)
        try:
            CLIENT = genai.Client(api_key=api_key)
        finally:
            if google_api_key is not None:
                os.environ["GOOGLE_API_KEY"] = google_api_key
    return CLIENT


def strip_fences(text: str) -> str:
    m = re.search(r"```(?:javascript|js|json)?\s*\n(.*?)```", text, re.DOTALL)
    return m.group(1).strip() if m else text.strip()


def extract_json(text: str) -> dict:
    stripped = strip_fences(text)
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model did not return JSON")
    return json.loads(stripped[start:end + 1])


def save_log(
    name: str,
    model: str,
    prompt: str,
    raw_output: str,
    code: str,
    duration_s: float,
    feedback: str,
    strategy: str,
    metadata: dict | None = None,
):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    log = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "action": "refine",
        "strategy": strategy,
        "game": name,
        "model": model,
        "feedback": feedback,
        "duration_s": round(duration_s, 2),
        "prompt_chars": len(prompt),
        "output_chars": len(raw_output),
        "code_chars": len(code),
        "prompt": prompt,
        "raw_output": raw_output,
    }
    if metadata:
        log["metadata"] = metadata
    log_path = LOG_DIR / f"{ts}_{name}_refine.json"
    log_path.write_text(json.dumps(log, indent=2))
    return log_path


def backup_game(name: str):
    src = JS_DIR / f"{name}.js"
    if not src.exists():
        return
    backup_dir = GAMES_DIR / "backups"
    backup_dir.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    (backup_dir / f"{name}_{ts}.js").write_text(src.read_text())


def find_matching_brace(text: str, open_index: int) -> int:
    depth = 0
    in_single = False
    in_double = False
    in_template = False
    in_line_comment = False
    in_block_comment = False
    escape = False

    for i in range(open_index, len(text)):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
            continue

        if in_single:
            if ch == "\\" and not escape:
                escape = True
                continue
            if ch == "'" and not escape:
                in_single = False
            escape = False
            continue

        if in_double:
            if ch == "\\" and not escape:
                escape = True
                continue
            if ch == '"' and not escape:
                in_double = False
            escape = False
            continue

        if in_template:
            if ch == "\\" and not escape:
                escape = True
                continue
            if ch == "`" and not escape:
                in_template = False
            escape = False
            continue

        if ch == "/" and nxt == "/":
            in_line_comment = True
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            continue
        if ch == "'":
            in_single = True
            continue
        if ch == '"':
            in_double = True
            continue
        if ch == "`":
            in_template = True
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i

    raise ValueError("Could not find matching brace")


def split_code_chunks(code: str) -> list[dict]:
    pattern = re.compile(r"^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{", re.MULTILINE)
    matches = list(pattern.finditer(code))
    if not matches:
        return [{"id": "file", "kind": "file", "label": "whole file", "start": 0, "end": len(code), "code": code}]

    chunks = []
    cursor = 0
    text_index = 0

    for match in matches:
        start = match.start()
        if start > cursor:
            text = code[cursor:start]
            if text.strip():
                chunk_id = "prelude" if cursor == 0 else f"text:{text_index}"
                label = "globals and setup state" if cursor == 0 else f"interstitial text {text_index}"
                chunks.append(
                    {
                        "id": chunk_id,
                        "kind": "text",
                        "label": label,
                        "start": cursor,
                        "end": start,
                        "code": text,
                    }
                )
                text_index += 1

        name = match.group(1)
        brace_index = code.find("{", match.end() - 1)
        end = find_matching_brace(code, brace_index) + 1
        chunks.append(
            {
                "id": f"function:{name}",
                "kind": "function",
                "label": name,
                "function_name": name,
                "start": start,
                "end": end,
                "code": code[start:end],
            }
        )
        cursor = end

    if cursor < len(code):
        tail = code[cursor:]
        if tail.strip():
            chunks.append(
                {
                    "id": f"text:{text_index}",
                    "kind": "text",
                    "label": f"interstitial text {text_index}",
                    "start": cursor,
                    "end": len(code),
                    "code": tail,
                }
            )
    return chunks


def summarize_chunk(chunk: dict) -> str:
    lines = [line.strip() for line in chunk["code"].splitlines() if line.strip()]
    preview = lines[0] if lines else ""
    preview = preview[:100]
    return f"{chunk['id']} | {chunk['kind']} | {chunk['label']} | {preview}"


def print_stream_header(model: str, prompt: str):
    print(f"  Using GEMINI_API_KEY={mask_api_key(os.environ.get('GEMINI_API_KEY'))}"
          f" (GOOGLE_API_KEY {'present' if os.environ.get('GOOGLE_API_KEY') else 'missing'})")
    print(f"  Model: {model}")
    print(f"  Prompt size: {len(prompt):,} chars")


def stream_text(client, model: str, prompt: str, *, label: str, on_chunk=None) -> str:
    t0 = time.time()
    print(f"  {label}")
    print_stream_header(model, prompt)

    stop_waiting = threading.Event()
    first_text = threading.Event()

    def heartbeat():
        while not stop_waiting.wait(5):
            if first_text.is_set():
                return
            elapsed = time.time() - t0
            print(f"  ... waiting for first stream chunk ({elapsed:.1f}s)", flush=True)

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()

    parts = []
    try:
        for chunk in client.models.generate_content_stream(model=model, contents=prompt):
            text = chunk.text or ""
            if text:
                first_text.set()
                print(text, end="", flush=True)
                parts.append(text)
                if on_chunk:
                    on_chunk(text)
    finally:
        stop_waiting.set()

    print()
    return "".join(parts)


def complete_text(client, model: str, prompt: str, *, label: str) -> str:
    t0 = time.time()
    print(f"  {label}")
    print_stream_header(model, prompt)

    stop_waiting = threading.Event()

    def heartbeat():
        while not stop_waiting.wait(5):
            elapsed = time.time() - t0
            print(f"  ... waiting for model response ({elapsed:.1f}s)", flush=True)

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        response = client.models.generate_content(model=model, contents=prompt)
    finally:
        stop_waiting.set()
    return response.text or ""


def select_chunks(client, model: str, name: str, feedback: str, chunks: list[dict], framing: dict) -> dict:
    catalog = "\n".join(f"- {summarize_chunk(chunk)}" for chunk in chunks)
    prompt = f"""{framing["select_intro"]}

Game: {name}
{framing["label"]}: {feedback}

Available chunks:
{catalog}

{REFINE_RULES}

Return JSON only:
{{
  "mode": "patch" or "rewrite",
  "chunk_ids": ["chunk ids to edit"],
  "reason": "brief reason"
}}

{framing["select_tail"]}"""
    raw = complete_text(client, model, prompt, label="Selecting target chunks...")
    selection = extract_json(raw)
    if "chunk_ids" not in selection or not isinstance(selection["chunk_ids"], list):
        selection["chunk_ids"] = []
    selection["mode"] = selection.get("mode", "rewrite")
    selection["_prompt"] = prompt
    selection["_raw"] = raw
    return selection


def build_patch_prompt(name: str, feedback: str, chunks: list[dict], framing: dict) -> str:
    chunk_text = []
    for chunk in chunks:
        chunk_text.append(
            f"CHUNK {chunk['id']} ({chunk['kind']}, {chunk['label']}):\n```javascript\n{chunk['code']}\n```"
        )
    joined_chunks = "\n\n".join(chunk_text)
    return f"""{framing["patch_intro"]}

Game: {name}
{framing["label"]}: {feedback}

{REFINE_RULES}

Only modify the chunks provided below. Return JSON only:
{{
  "edits": [
    {{
      "chunk_id": "function:draw",
      "replacement": "complete replacement code for that chunk only"
    }}
  ],
  "notes": "brief summary"
}}

Rules for replacements:
- For function chunks, replacement must include the full function definition with the same function name.
- For text chunks, replacement must be the full replacement text for that chunk.
- Do not include untouched chunks.
- Do not include markdown fences in the JSON values.

Editable chunks:

{joined_chunks}
"""


def validate_patch_edit(chunk: dict, replacement: str):
    replacement = replacement.strip()
    if not replacement:
        raise ValueError(f"Empty replacement for {chunk['id']}")
    if chunk["kind"] == "function":
        fn_name = chunk["function_name"]
        pattern = re.compile(rf"^function\s+{re.escape(fn_name)}\s*\(", re.MULTILINE)
        if not pattern.search(replacement):
            raise ValueError(f"Replacement for {chunk['id']} must define function {fn_name}")


def apply_patch_edits(code: str, chunks: list[dict], edits: list[dict]) -> str:
    chunk_map = {chunk["id"]: chunk for chunk in chunks}
    normalized = []
    for edit in edits:
        chunk_id = edit.get("chunk_id")
        if chunk_id not in chunk_map:
            raise ValueError(f"Unknown chunk id: {chunk_id}")
        replacement = edit.get("replacement", "")
        validate_patch_edit(chunk_map[chunk_id], replacement)
        normalized.append((chunk_map[chunk_id], replacement))

    normalized.sort(key=lambda item: item[0]["start"], reverse=True)
    updated = code
    for chunk, replacement in normalized:
        updated = updated[:chunk["start"]] + replacement.rstrip() + updated[chunk["end"]:]
    return updated


def validate_refined_code(code: str):
    for name in REQUIRED_FUNCTIONS:
        if not re.search(rf"^function\s+{re.escape(name)}\s*\(", code, re.MULTILINE):
            raise ValueError(f"Missing required function: {name}")
    if "mulberry32" not in code:
        raise ValueError("Missing seeded RNG")


def full_rewrite(client, model: str, name: str, feedback: str, code: str, framing: dict, *, on_chunk=None) -> tuple[str, str]:
    prompt = f"""Here is the current game code:

{code}

{framing["label"]}:
{feedback}

{framing["rewrite_task"]}

{REFINE_RULES}

Output ONLY the complete updated JavaScript code. No markdown fences, no explanation."""
    raw = stream_text(client, model, prompt, label="Falling back to full-file rewrite...", on_chunk=on_chunk)
    return prompt, raw


def refine_game(name: str, feedback: str, model_key: str, *, apply: bool = True, on_event=None, intent: str = "fix") -> dict:
    client = get_client()
    if not client:
        raise RuntimeError("GEMINI_API_KEY not set")

    path = JS_DIR / f"{name}.js"
    if not path.exists():
        raise FileNotFoundError(f"Game not found: {path}")

    code = path.read_text()
    model = MODELS.get(model_key, MODELS["flash"])
    chunks = split_code_chunks(code)
    framing = FRAMINGS.get(intent, FRAMINGS["fix"])

    def emit(ev_type, **kwargs):
        if on_event:
            on_event({"type": ev_type, **kwargs})

    print(f"  {'Forking' if intent == 'variant' else 'Refining'} {name} with {model}...")
    started = time.time()

    emit("status", text="Selecting chunks to edit...")
    selection = select_chunks(client, model, name, feedback, chunks, framing)
    chunk_ids = [chunk_id for chunk_id in selection["chunk_ids"] if chunk_id in {chunk["id"] for chunk in chunks}]
    print(f"  Selection mode: {selection['mode']}")
    if chunk_ids:
        print(f"  Selected chunks: {', '.join(chunk_ids)}")
    if selection.get("reason"):
        print(f"  Reason: {selection['reason']}")

    mode_label = selection["mode"]
    if chunk_ids:
        mode_label += f" — chunks: {', '.join(chunk_ids)}"
    if selection.get("reason"):
        mode_label += f" — {selection['reason']}"
    emit("status", text=mode_label)

    strategy = "patch"
    metadata = {
        "selection": {
            "mode": selection["mode"],
            "chunk_ids": chunk_ids,
            "reason": selection.get("reason", ""),
        }
    }

    try:
        if selection["mode"] == "rewrite" or not chunk_ids:
            raise ValueError("Using full rewrite fallback")

        selected_chunks = [chunk for chunk in chunks if chunk["id"] in chunk_ids]
        patch_prompt = build_patch_prompt(name, feedback, selected_chunks, framing)
        emit("status", text="Generating targeted patch...")
        patch_raw = stream_text(client, model, patch_prompt, label="Generating targeted patch...",
                                on_chunk=lambda t: emit("chunk", text=t))
        patch_data = extract_json(patch_raw)
        edits = patch_data.get("edits", [])
        if not edits:
            raise ValueError("Patch response contained no edits")

        new_code = apply_patch_edits(code, chunks, edits)
        validate_refined_code(new_code)
        raw_output = patch_raw
        prompt = patch_prompt
        metadata["patch"] = {
            "notes": patch_data.get("notes", ""),
            "edit_chunk_ids": [edit.get("chunk_id") for edit in edits],
        }
    except Exception as patch_error:
        strategy = "rewrite"
        metadata["patch_error"] = str(patch_error)
        emit("status", text=f"Patch failed, falling back to full rewrite...")
        prompt, raw_output = full_rewrite(client, model, name, feedback, code, framing,
                                          on_chunk=lambda t: emit("chunk", text=t))
        new_code = strip_fences(raw_output)
        validate_refined_code(new_code)

    duration = time.time() - started
    if apply:
        backup_game(name)
        path.write_text(new_code)

    log_path = save_log(
        name=name,
        model=model,
        prompt=prompt,
        raw_output=raw_output,
        code=new_code,
        duration_s=duration,
        feedback=feedback,
        strategy=strategy,
        metadata=metadata,
    )
    print(f"  Refined {name} ({duration:.1f}s, {len(new_code)} bytes, strategy={strategy}, log: {log_path.name})")

    return {
        "code": new_code,
        "duration_s": round(duration, 2),
        "strategy": strategy,
        "log_path": str(log_path),
    }


def main():
    parser = argparse.ArgumentParser(description="Refine a generated game via Gemini")
    parser.add_argument("--game", required=True)
    parser.add_argument("--feedback", required=True)
    parser.add_argument("--model", choices=list(MODELS.keys()), default="flash")
    parser.add_argument("--dry-run", action="store_true", help="Do not overwrite the game file")
    args = parser.parse_args()

    refine_game(args.game, args.feedback, args.model, apply=not args.dry_run)


if __name__ == "__main__":
    main()
