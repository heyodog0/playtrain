"""Render one of OUR states through Craftax's own pixel renderer and diff.

The two environments cannot be compared by seed: Craftax uses threefry and a
different worldgen, so the same seed is a different world. The only valid
comparison is to take a state produced by our port, inject it into Craftax's
EnvState, and render both.
"""
import sys, struct, json
import numpy as np
import jax.numpy as jnp
from craftax.craftax_classic.envs.craftax_state import EnvState, Inventory, Mobs
from craftax.craftax_classic.renderer import make_craftax_pixel_renderer
from craftax.craftax_classic.constants import OBS_DIM, BLOCK_PIXEL_SIZE_AGENT

dump = json.load(open(sys.argv[1]))

def mobs(key, n, with_cd=True):
    d = dump[key]
    return Mobs(
        position=jnp.array(d["pos"], dtype=jnp.int32).reshape(n, 2),
        health=jnp.array(d["hp"], dtype=jnp.int32).reshape(n),
        mask=jnp.array(d["mask"], dtype=bool).reshape(n),
        attack_cooldown=jnp.array(d.get("cd", [0]*n), dtype=jnp.int32).reshape(n),
    )

inv = Inventory(**{k: jnp.array(v, dtype=jnp.int32) for k, v in dump["inventory"].items()})

state = EnvState(
    map=jnp.array(dump["map"], dtype=jnp.int32).reshape(64, 64),
    mob_map=jnp.array(dump["mob_map"], dtype=bool).reshape(64, 64),
    player_position=jnp.array(dump["player_position"], dtype=jnp.int32),
    player_direction=jnp.array(dump["player_direction"], dtype=jnp.int32),
    player_health=jnp.array(dump["health"], dtype=jnp.int32),
    player_food=jnp.array(dump["food"], dtype=jnp.int32),
    player_drink=jnp.array(dump["drink"], dtype=jnp.int32),
    player_energy=jnp.array(dump["energy"], dtype=jnp.int32),
    is_sleeping=jnp.array(dump["is_sleeping"], dtype=bool),
    player_recover=jnp.array(dump["recover"], dtype=jnp.float32),
    player_hunger=jnp.array(dump["hunger"], dtype=jnp.float32),
    player_thirst=jnp.array(dump["thirst"], dtype=jnp.float32),
    player_fatigue=jnp.array(dump["fatigue"], dtype=jnp.float32),
    inventory=inv,
    zombies=mobs("zombies", 3),
    cows=mobs("cows", 3),
    skeletons=mobs("skeletons", 2),
    arrows=mobs("arrows", 3),
    arrow_directions=jnp.array(dump["arrow_directions"], dtype=jnp.int32).reshape(3, 2),
    growing_plants_positions=jnp.array(dump["plant_pos"], dtype=jnp.int32).reshape(10, 2),
    growing_plants_age=jnp.array(dump["plant_age"], dtype=jnp.int32).reshape(10),
    growing_plants_mask=jnp.array(dump["plant_mask"], dtype=bool).reshape(10),
    light_level=jnp.array(dump["light_level"], dtype=jnp.float32),
    achievements=jnp.array(dump["achievements"], dtype=bool).reshape(22),
    state_rng=jnp.array([0, 0], dtype=jnp.uint32),
    timestep=jnp.array(dump["timestep"], dtype=jnp.int32),
    fractal_noise_angles=(None, None, None, None),
)

render = make_craftax_pixel_renderer(BLOCK_PIXEL_SIZE_AGENT)
img = np.asarray(render(state))
print("craftax frame:", img.shape, img.dtype, "range", img.min(), img.max())
np.save("/tmp/craftax_ref.npy", img)
