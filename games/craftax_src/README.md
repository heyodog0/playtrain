# `games/craftax_src/` — vendored PufferLib reference C

These files are **reference sources, not build inputs**. Nothing in PlayTrain
compiles them into a wheel. They are here so the Craftax-Classic parity port in
`examples/games/multifile/parity/craftax_classic/` can be diffed against, and
compiled against, the exact C it claims bit-exact parity with.

**Do not edit anything in this directory.** It is the reference. If the header
needs a symbol we do not have (`raylib.h`, `ini.h`), the stub goes in
`examples/games/multifile/parity/craftax_classic/reference/stubs/`, never here.

## Provenance

| field | value |
|---|---|
| upstream | https://github.com/PufferAI/PufferLib |
| commit | `6ffa5b10dbbbe4d1e8288367c7d9d3acd3bad4a2` |
| vendored | 2026-09-14 |
| license | MIT — see `LICENSE`, and the row in `/THIRD_PARTY_LICENSES.md` |

## Files

Upstream paths are relative to the repository root at the pinned commit.
`sha256` is of the file as committed here; `git blob` is the upstream object id,
which was checked against the commit's tree — every file is byte-identical to
upstream.

| file | upstream path | lines | sha256 | git blob |
|---|---|---|---|---|
| `craftax_classic.h` | `ocean/craftax_classic/craftax_classic.h` | 1222 | `f76c0f712e3d0de6b36b4fb417144f84bd0ef37a7c6aac9e19a98da9ddcf5c10` | `b60c8d1339b321a1df76680354c7f1701f0babcc` |
| `craftax.h` | `ocean/craftax/craftax.h` | 3055 | `0ebce67fd2d16fa71c51999cde461edf4a35f17bf7a0c232b06eadee40151ca9` | `622a3e4425a14a5bc253c28ac77d006a13a99fab` |
| `constants.h` | `ocean/craftax/constants.h` | 502 | `3292c49a62d0c5b7ac07a2bbd5f545f1b247fd8a86366e2bea751f16761f30ab` | `76615bfe9d8af46549e8c8f2276b5be7aad553a7` |
| `craftax_net.h` | `ocean/craftax/craftax_net.h` | 103 | `f19c26d60c2b772bf2635b447ed99b8818d0851cc602f744c7bb6159eae280b7` | `f35847ed1e41d3a54c84debbe8f25c5b052c07af` |
| `pufferenv.h` | `src/pufferenv.h` | 81 | `3324a670791e2b3e46cbe7d10d9233d52fbc258e0d7e37d5b0c470e580de880c` | `fe40d541d9047f312944aa4671d523f04a7da07a` |
| `LICENSE` | `LICENSE` | — | `24dae53fbe9da4b15693499b043783c7572b894ac9a5dbc6889856a409c24dee` | `daee191768799a9dc7c7053862dcdb77062b77fd` |

`craftax_classic.h` is the parity target. `craftax.h`, `constants.h` and
`craftax_net.h` are full Craftax, vendored now so the later `parity/craftax/`
port does not have to redo the provenance work. `craftax_parity.h` (the
JAX-exact full-Craftax variant) is deliberately **not** vendored; it is not the
target of any port here.

## Re-verifying

```sh
cd games/craftax_src && shasum -a 256 -c <<'SUMS'
f76c0f712e3d0de6b36b4fb417144f84bd0ef37a7c6aac9e19a98da9ddcf5c10  craftax_classic.h
0ebce67fd2d16fa71c51999cde461edf4a35f17bf7a0c232b06eadee40151ca9  craftax.h
3292c49a62d0c5b7ac07a2bbd5f545f1b247fd8a86366e2bea751f16761f30ab  constants.h
f19c26d60c2b772bf2635b447ed99b8818d0851cc602f744c7bb6159eae280b7  craftax_net.h
3324a670791e2b3e46cbe7d10d9233d52fbc258e0d7e37d5b0c470e580de880c  pufferenv.h
24dae53fbe9da4b15693499b043783c7572b894ac9a5dbc6889856a409c24dee  LICENSE
SUMS
```
