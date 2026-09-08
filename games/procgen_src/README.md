# ProcGen reference sources

The original C++ implementations of the ProcGen games PlayTrain clones, kept so a
clone can be checked against the mechanics it is imitating. Taken verbatim from
[openai/procgen](https://github.com/openai/procgen) (`procgen/src/games/`) and
redistributed under its MIT license — see [LICENSE](LICENSE).

Nothing here is compiled or executed by PlayTrain. They do not build in place: they
include headers from the ProcGen tree that are not vendored. Read them, don't run them.

The PlayTrain clones themselves are original JavaScript in `examples/games/js/`, written
against these mechanics rather than translated from this code.
