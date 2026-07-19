"""PlayTrain — LLM-generated 2D game environments + a headless RL runtime.

Subpackages:
  - ``playtrain.runtime`` — headless Node.js / QuickJS game environments for
    Gymnasium (NodeGymEnv, QuickJSEnv, NodeVecEnv, NativeVecEnv, …). Runs JS
    games (p5.js, Matter.js, Three.js) as RL envs without a browser.
  - ``playtrain.gen`` — LLM (Gemini) game generation + the ProcGen-style
    validation harness that gates which generated games ship.
"""

__version__ = "0.1.0"
