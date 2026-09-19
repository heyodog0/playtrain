#!/usr/bin/env python
"""G2 reference: 10,000 keys = split(PRNGKey(20260919), 10000); for each, randint(key, (), 0, 256,
uint8) and the two words of split(key)[0] and split(key)[1]. Written compactly:
`randint` as 10,000 hex bytes, `split_sha1` over the 40,000 split words (uint32 little-endian).

    python export_randint.py --out vectors/randint_10k.json      (oracle venv; needs only jax)
"""
import hashlib
import json

import jax
import jax.numpy as jnp
import numpy as np

N = 10_000
ROOT_SEED = 20260919

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); a = ap.parse_args()
    keys = jax.random.split(jax.random.PRNGKey(ROOT_SEED), N)
    r = jax.vmap(lambda k: jax.random.randint(k, (), 0, 256, jnp.uint8))(keys)
    sp = jax.vmap(lambda k: jax.random.key_data(jax.random.split(k)).reshape(-1))(keys)   # (N, 4)
    kd = np.asarray(keys, dtype=np.uint32)
    out = {"jax": jax.__version__, "partitionable": bool(jax.config.jax_threefry_partitionable),
           "n": N, "root_seed": ROOT_SEED,
           "first_keys": [[int(x) for x in kd[i]] for i in range(4)],
           "randint_hex": bytes(np.asarray(r, dtype=np.uint8)).hex(),
           "split_sha1": hashlib.sha1(np.asarray(sp, dtype=np.uint32).astype("<u4").tobytes()).hexdigest()}
    json.dump(out, open(a.out, "w"), sort_keys=True); open(a.out, "a").write("\n")
    print(f"{N} keys -> {a.out}")
