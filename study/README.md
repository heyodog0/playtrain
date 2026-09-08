# Human study harness

The browser harness that collected the paper's human baseline. Participants play through
PlayTrain's own JavaScript runtime, so every session can be replayed through the training
environment and has to reproduce the same score.

Needs Node 18 or newer. No install step.

## See it running

```console
$ node study/study-serve.mjs
```

Builds the study and serves it on `http://localhost:8080`. Play it, and your session is
saved to `dist/study-sessions/`. Press `ctrl`+`shift`+`alt`+`D` for a debug menu that jumps
to any screen and runs the whole thing with 10-second blocks.

Replay what you just played:

```console
$ node study/verify-replay.mjs dist/study-sessions/<file>.json
```

Or replay a real participant, and render it to a GIF:

```console
$ gunzip -c reproduction/data/study/p11.json.gz > p11.json
$ node study/verify-replay.mjs p11.json
$ node study/replay-video.mjs p11.json --game breakout --best
```

## Everything else

| command | what it answers |
|---|---|
| `node study/build-study.mjs --out dist/study` | Build the static site. 11 self-contained files, no network at play time. Each `block/<game>/index.html` also runs on its own. |
| `node study/study-audit.mjs examples/games/js` | Did participants play the same game files the agents trained on? |
| `bash study/study-parity.sh` | Do the JavaScript rasterizer, the Rust rasterizer and the native QuickJS backend agree bit for bit? |
| `node study/study-browser-check.mjs` | Do Chromium, Firefox and WebKit produce identical traces? |

`study-config.json` holds the protocol: games, block length, seeds, action mode. Every
field carries a `_comment` explaining the value.

**Before collecting data from anyone:** the consent text in `study-screens.mjs` is a
template, not an approved protocol. Replace it with text your own ethics board has
approved and fill in the blank fields in `study-config.json`. `build-study.mjs` refuses to
build with `--upload` until you do.
