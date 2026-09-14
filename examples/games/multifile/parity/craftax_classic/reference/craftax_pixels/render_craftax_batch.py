"""Render every state compare.py exported through Craftax's own renderer.

    # in a venv with craftax installed (README.md):
    uv run python <repo>/reference/craftax_pixels/render_craftax_batch.py /tmp/night

Reads DIR/state_NNN.json and DIR/meta.json, writes DIR/craftax.npy, a
(n, 63, 63, 3) float32 stack — compare.py --diff casts it to uint8, which is
what `.astype(uint8)` does to Craftax's float observation.

Each state's `state_rng` is the key compare.py chose for that frame
(meta.json). Craftax's night static is drawn from it, so the same key has to
go into both renderers for the comparison to mean anything; passing zeros
here would compare two different random fields.
"""
import sys, json, pathlib
import numpy as np
import jax.numpy as jnp
from craftax.craftax_classic.envs.craftax_state import EnvState, Inventory, Mobs
from craftax.craftax_classic.renderer import make_craftax_pixel_renderer
from craftax.craftax_classic.constants import BLOCK_PIXEL_SIZE_AGENT

d0 = pathlib.Path(sys.argv[1])
meta = json.loads((d0 / 'meta.json').read_text())
render = make_craftax_pixel_renderer(BLOCK_PIXEL_SIZE_AGENT)


def mobs(m, n):
    return Mobs(position=jnp.array(m['pos'], jnp.int32).reshape(n, 2),
                health=jnp.array(m['hp'], jnp.int32).reshape(n),
                mask=jnp.array(m['mask'], bool).reshape(n),
                attack_cooldown=jnp.array(m['cd'], jnp.int32).reshape(n))


out = []
for m in meta:
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
        state_rng=jnp.array(m['state_rng'], jnp.uint32),
        timestep=jnp.array(d['timestep'], jnp.int32),
        fractal_noise_angles=(None, None, None, None))
    out.append(np.asarray(render(st)))
np.save(d0 / 'craftax.npy', np.stack(out))
print('rendered', len(out), 'craftax frames ->', d0 / 'craftax.npy')
