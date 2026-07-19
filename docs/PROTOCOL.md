# Binary IPC protocol

`game-worker.mjs` and `NodeGymEnv` communicate over the worker's `stdin`/`stdout` using a length-prefixed binary frame format.

## Frame layout

Every frame, in either direction:

```
+---------+---------+---------+-----------+
| 4 bytes | 4 bytes | N bytes | M bytes   |
| meta_len| bin_len | JSON    | binary    |
+---------+---------+---------+-----------+
```

- `meta_len`: big-endian uint32, length of the JSON metadata in bytes.
- `bin_len`: big-endian uint32, length of the binary payload in bytes (0 if absent).
- `JSON`: UTF-8 encoded JSON object.
- `binary`: raw bytes (typically pixel observations).

## Worker startup

```
node runtime/game-worker.mjs --game <path> [--obs-mode rgb|gray] [--obs-size 64] [--matter]
```

Flags:
- `--game <path>` — absolute path to the JS game file. Required.
- `--obs-mode rgb|gray` — observation channels. Default `rgb`.
- `--obs-size N` — square observation side length. Default 64.
- `--matter` — load Matter.js into the game's VM context. Auto-detected by `NodeGymEnv` from game source.

## Commands (Python → worker)

JSON metadata; no binary payload.

### `ping`

```json
{"cmd": "ping"}
```

Response includes `action_meanings` so the client can verify protocol compatibility.

### `reset`

```json
{"cmd": "reset", "seed": 42, "max_steps": 2000}
```

Both `seed` and `max_steps` are optional. Response includes the initial observation as the binary payload.

### `step`

```json
{"cmd": "step", "action": 3}
```

`action` is an integer in `[0, 8)`. Response carries reward, terminated/truncated flags, and the next observation as binary.

### `close`

```json
{"cmd": "close"}
```

Worker tears down the game and exits.

## Responses (worker → Python)

Every response includes `ok: true|false`.

### Success — `reset`

```json
{"ok": true, "info": {...}}
```
Binary payload: `obs_size * obs_size * channels` uint8 bytes.

### Success — `step`

```json
{"ok": true, "reward": 0.0, "terminated": false, "truncated": false, "info": {...}}
```
Binary payload: observation bytes as above.

### Success — `ping`

```json
{"ok": true, "pong": true, "action_meanings": ["NOOP", "LEFT", ...]}
```

### Failure

```json
{"ok": false, "error": "<message>"}
```

## Observation encoding

Pixels are written in row-major order:

- **RGB**: `H * W * 3` bytes, channel order R, G, B.
- **Grayscale**: `H * W` bytes.

No headers, no padding — Python decodes via `np.frombuffer(..., dtype=np.uint8).reshape(...)`.

## Action mapping

| Action | Held keys      | Pressed key |
|--------|----------------|-------------|
| 0 NOOP        | —          | —     |
| 1 LEFT        | LEFT       | —     |
| 2 RIGHT       | RIGHT      | —     |
| 3 UP          | —          | UP    |
| 4 DOWN        | —          | DOWN  |
| 5 D / SPACE   | —          | D     |
| 6 LEFT + D    | LEFT       | D     |
| 7 RIGHT + D   | RIGHT      | D     |

The shim translates these into p5.js `keyIsDown()` and `keyPressed()` calls inside the game's VM.
