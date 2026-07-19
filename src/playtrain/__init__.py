"""PlayTrain — LLM-generated 2D game environments + a headless RL runtime.

Subpackages:
  - ``playtrain.runtime`` — headless QuickJS / Node.js game environments for
    Gymnasium (QuickJSEnv/GameEnv is the default, plus NativeVecEnv, PlayTrainEnv,
    PlayTrainVecEnv). Runs p5.js / Matter.js games as RL envs without a browser.
  - ``playtrain.gen`` — LLM (Gemini) game generation + the ProcGen-style
    validation harness that gates which generated games ship.
"""

__version__ = "0.1.0"
