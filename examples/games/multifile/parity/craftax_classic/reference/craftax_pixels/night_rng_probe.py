# Does Craftax's night rendering depend on state_rng? If so, our port cannot
# reproduce it: state_rng is a JAX threefry key with no counterpart in
# PufferLib's C (which has a single PCG stream and no such field).
import json, numpy as np, jax.numpy as jnp
from craftax.craftax_classic.envs.craftax_state import EnvState, Inventory, Mobs
from craftax.craftax_classic.renderer import make_craftax_pixel_renderer
from craftax.craftax_classic.constants import BLOCK_PIXEL_SIZE_AGENT

d = json.load(open('/tmp/state_s3_t0.json'))
def mobs(k,n):
    m=d[k]; return Mobs(position=jnp.array(m['pos'],jnp.int32).reshape(n,2),
        health=jnp.array(m['hp'],jnp.int32).reshape(n), mask=jnp.array(m['mask'],bool).reshape(n),
        attack_cooldown=jnp.array(m.get('cd',[0]*n),jnp.int32).reshape(n))
def build(light, rng):
    return EnvState(
        map=jnp.array(d['map'],jnp.int32).reshape(64,64), mob_map=jnp.array(d['mob_map'],bool).reshape(64,64),
        player_position=jnp.array(d['player_position'],jnp.int32), player_direction=jnp.array(d['player_direction'],jnp.int32),
        player_health=jnp.array(d['health'],jnp.int32), player_food=jnp.array(d['food'],jnp.int32),
        player_drink=jnp.array(d['drink'],jnp.int32), player_energy=jnp.array(d['energy'],jnp.int32),
        is_sleeping=jnp.array(False), player_recover=jnp.array(0.,jnp.float32), player_hunger=jnp.array(0.,jnp.float32),
        player_thirst=jnp.array(0.,jnp.float32), player_fatigue=jnp.array(0.,jnp.float32),
        inventory=Inventory(**{k: jnp.array(v,jnp.int32) for k,v in d['inventory'].items()}),
        zombies=mobs('zombies',3), cows=mobs('cows',3), skeletons=mobs('skeletons',2), arrows=mobs('arrows',3),
        arrow_directions=jnp.array(d['arrow_directions'],jnp.int32).reshape(3,2),
        growing_plants_positions=jnp.array(d['plant_pos'],jnp.int32).reshape(10,2),
        growing_plants_age=jnp.array(d['plant_age'],jnp.int32).reshape(10),
        growing_plants_mask=jnp.array(d['plant_mask'],bool).reshape(10),
        light_level=jnp.array(light,jnp.float32), achievements=jnp.array(d['achievements'],bool).reshape(22),
        state_rng=jnp.array(rng,jnp.uint32), timestep=jnp.array(d['timestep'],jnp.int32),
        fractal_noise_angles=(None,None,None,None))

r = make_craftax_pixel_renderer(BLOCK_PIXEL_SIZE_AGENT)
for light in (1.0, 0.7, 0.4, 0.2):
    a = np.asarray(r(build(light, [0,0])))
    b = np.asarray(r(build(light, [12345,6789])))
    diff = int((np.abs(a-b).sum(axis=2) > 0).sum())
    print(f'light={light}: frame differs between two state_rng values in {diff} of 3969 px')
