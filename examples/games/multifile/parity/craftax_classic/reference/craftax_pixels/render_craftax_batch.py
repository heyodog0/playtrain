"""Render every state compare.py exported through Craftax's own renderer,
driven by the same driver seed.

    # in a venv with craftax installed (README.md):
    uv run python <repo>/reference/craftax_pixels/render_craftax_batch.py /tmp/night

Reads DIR/state_NNN.json and DIR/meta.json, writes DIR/craftax.npy, a
(n, 63, 63, 3) float32 stack — compare.py --diff casts it to uint8, which is
what `.astype(uint8)` does to Craftax's float observation.

The night static is drawn from `state.state_rng`, which Craftax's step sets
from the key the DRIVER passes in. JAX cannot branch control flow on values,
so the number of splits per step is fixed and state_rng is a function of the
driver seed and the step index alone:

    dk = PRNGKey(driver_seed)
    per step: dk, sk = split(dk); rng = sk; repeat 5: rng, sub = split(rng)
    state_rng = sub

This script derives it that way with JAX's own `split`, from
meta.json's `driver_seed`, and does two things to keep itself honest:

  * it steps a REAL Craftax environment with the same driver key and checks
    the chain against `state.state_rng` on every one of those steps, so the
    formula is anchored to Craftax's stepping, not to a reading of its code;
  * it checks the key our JS derived per frame (meta.json `state_rng`)
    against the JAX-derived one — two implementations, same seed, same key.

Nothing is handed across: both renderers see only the driver seed.
"""
import sys, json, pathlib
import numpy as np
import jax, jax.numpy as jnp
from craftax.craftax_classic.envs.craftax_state import EnvState, Inventory, Mobs
from craftax.craftax_classic.envs.craftax_symbolic_env import CraftaxClassicSymbolicEnv
from craftax.craftax_classic.renderer import make_craftax_pixel_renderer
from craftax.craftax_classic.constants import BLOCK_PIXEL_SIZE_AGENT

d0 = pathlib.Path(sys.argv[1])
meta = json.loads((d0 / 'meta.json').read_text())
render = make_craftax_pixel_renderer(BLOCK_PIXEL_SIZE_AGENT)

drivers = {m['driver_seed'] for m in meta}
assert len(drivers) == 1, f'one driver seed per run, got {drivers}'
driver_seed = drivers.pop()


def key_words(k):
    return [int(x) for x in np.asarray(k).astype(np.uint32).tolist()]


def derive(driver_seed, nsteps):
    """state_rng per step from the driver seed alone, with JAX's split."""
    dk = jax.random.PRNGKey(driver_seed)
    out = []
    for _ in range(nsteps):
        dk, sk = jax.random.split(dk)
        rng = sk
        for _ in range(5):
            rng, sub = jax.random.split(rng)
        out.append(key_words(sub))
    return out


def actual(driver_seed, nsteps, reset_seed=0):
    """state_rng per step from stepping Craftax itself with that driver key."""
    env = CraftaxClassicSymbolicEnv()
    params = env.default_params
    obs, state = env.reset(jax.random.PRNGKey(reset_seed), params)
    dk = jax.random.PRNGKey(driver_seed)
    out = []
    for i in range(nsteps):
        dk, sk = jax.random.split(dk)
        obs, state, *_ = env.step(sk, state, i % 17, params)
        out.append(key_words(state.state_rng))
    return out


keys = derive(driver_seed, len(meta))
anchor = min(len(meta), 40)
real = actual(driver_seed, anchor)
assert keys[:anchor] == real, 'the split chain does not match Craftax stepping'
print(f'driver seed {driver_seed}: chain anchored to Craftax env.step on {anchor} steps')
js_agree = sum(1 for m, k in zip(meta, keys) if m['state_rng'] == k)
print(f'  JS-derived state_rng agrees with JAX-derived on {js_agree}/{len(meta)} frames')
assert js_agree == len(meta), 'our JS derives a different state_rng from the same driver seed'


def mobs(m, n):
    return Mobs(position=jnp.array(m['pos'], jnp.int32).reshape(n, 2),
                health=jnp.array(m['hp'], jnp.int32).reshape(n),
                mask=jnp.array(m['mask'], bool).reshape(n),
                attack_cooldown=jnp.array(m['cd'], jnp.int32).reshape(n))


out = []
for m, key in zip(meta, keys):
    d = json.loads((d0 / f"state_{m['i']:03d}.json").read_text())
    st = EnvState(
        map=jnp.array(d['map'], jnp.int32).reshape(64, 64),
        mob_map=jnp.array(d['mob_map'], bool).reshape(64, 64),
        player_position=jnp.array(d['player_position'], jnp.int32),
        player_direction=jnp.array(d['player_direction'], jnp.int32),
        player_health=jnp.array(d['health'], jnp.int32), player_food=jnp.array(d['food'], jnp.int32),
        player_drink=jnp.array(d['drink'], jnp.int32), player_energy=jnp.array(d['energy'], jnp.int32),
        is_sleeping=jnp.array(d['is_sleeping']), player_recover=jnp.array(d['recover'], jnp.float32),
        player_hunger=jnp.array(d['hunger'], jnp.float32), player_thirst=jnp.array(d['thirst'], jnp.float32),
        player_fatigue=jnp.array(d['fatigue'], jnp.float32),
        inventory=Inventory(**{k: jnp.array(v, jnp.int32) for k, v in d['inventory'].items()}),
        zombies=mobs(d['zombies'], 3), cows=mobs(d['cows'], 3), skeletons=mobs(d['skeletons'], 2),
        arrows=mobs(d['arrows'], 3),
        arrow_directions=jnp.array(d['arrow_directions'], jnp.int32).reshape(3, 2),
        growing_plants_positions=jnp.array(d['plant_pos'], jnp.int32).reshape(10, 2),
        growing_plants_age=jnp.array(d['plant_age'], jnp.int32).reshape(10),
        growing_plants_mask=jnp.array(d['plant_mask'], bool).reshape(10),
        light_level=jnp.array(d['light_level'], jnp.float32),
        achievements=jnp.array(d['achievements'], bool).reshape(22),
        state_rng=jnp.array(key, jnp.uint32),
        timestep=jnp.array(d['timestep'], jnp.int32),
        fractal_noise_angles=(None, None, None, None))
    out.append(np.asarray(render(st)))
np.save(d0 / 'craftax.npy', np.stack(out))
print('rendered', len(out), 'craftax frames ->', d0 / 'craftax.npy')
