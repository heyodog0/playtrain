"""Gate for task 7b: the second games root and the sidecar.

PLAN 3.1 and 3.2, and nothing else — these are the only runtime changes the
plan sanctions, so this gate also checks that catalog games are unaffected.

The game cannot be *stepped* yet: 90_playtrain.js (resetGame, getGameState,
input handling) lands in 8a. What is checkable now is discovery, resolution
and sidecar defaulting.
"""

from __future__ import annotations

import json

import pytest

from ccref import GAME

from playtrain import _paths
from playtrain.runtime.env import (
    DEFAULT_MAX_STEPS,
    game_search_roots,
    list_available_games,
    load_sidecar,
    resolve_game_file,
)

NAME = "craftax_classic"


def test_the_multifile_dist_is_a_search_root():
    roots = game_search_roots()
    dists = _paths.multifile_dist_dirs()
    assert dists, "no built multifile dist/ found"
    for d in dists:
        assert d in roots, f"{d} is not in the search roots"


def test_the_catalog_still_comes_first():
    """A multi-file game must never shadow a catalog game of the same name."""
    roots = game_search_roots()
    assert roots[0] == _paths.games_dir()


def test_the_bundled_game_is_discoverable_by_name():
    games = list_available_games()
    assert NAME in games
    assert len(games) == len(set(games)), "a name is listed twice"


def test_catalog_games_are_still_discoverable():
    games = list_available_games()
    catalog = sorted(p.stem for p in _paths.games_dir().glob("*.js"))
    assert catalog, "the catalog is empty; resolution is broken"
    missing = [g for g in catalog if g not in games]
    assert not missing, f"catalog games vanished from the listing: {missing}"


def test_the_name_resolves_into_the_dist():
    path = resolve_game_file(NAME)
    assert path.is_file()
    assert path.parent.name == "dist"
    assert path.parent.parent.name == NAME


def test_an_explicit_games_dir_still_wins():
    """Passing games_dir= must not start pulling in multifile dists."""
    roots = game_search_roots(_paths.games_dir())
    assert roots == [_paths.games_dir()]


def test_the_sidecar_is_found_and_declares_seventeen_actions():
    sidecar = load_sidecar(resolve_game_file(NAME))
    assert sidecar is not None
    assert len(sidecar["actions"]) == 17
    assert sidecar["max_steps"] == 10000
    assert sidecar["action_space"] == "craftax17"


def test_catalog_games_have_no_sidecar():
    """The mechanism must be invisible to every existing game."""
    catalog = sorted(_paths.games_dir().glob("*.js"))
    assert catalog
    for path in catalog[:15]:
        assert load_sidecar(path) is None, f"{path.name} unexpectedly has a sidecar"


def test_the_sidecar_action_table_loads_as_a_space():
    """The sidecar's actions must be a valid discrete space, not just JSON."""
    from playtrain.runtime.action_space import action_names, load_space_spec

    sidecar = load_sidecar(resolve_game_file(NAME))
    spec = load_space_spec(sidecar["actions"])
    assert spec["type"] == "discrete"
    names = action_names(spec["actions"])
    assert len(names) == 17
    assert names[0] == "NOOP"
    assert names[5] == "DO"
    assert names[16] == "MAKE_IRON_SWORD"


def test_action_indices_match_the_c_enum():
    """The sidecar's order IS the C's ACT_* order, which is what lets one
    action file drive both sides with no mapping."""
    sidecar = load_sidecar(resolve_game_file(NAME))
    names = [a["name"] for a in sidecar["actions"]]
    assert names == [
        "NOOP", "LEFT", "RIGHT", "UP", "DOWN", "DO", "SLEEP",
        "PLACE_STONE", "PLACE_TABLE", "PLACE_FURNACE", "PLACE_PLANT",
        "MAKE_WOOD_PICK", "MAKE_STONE_PICK", "MAKE_IRON_PICK",
        "MAKE_WOOD_SWORD", "MAKE_STONE_SWORD", "MAKE_IRON_SWORD",
    ]


def test_default_max_steps_is_unchanged_for_catalog_games():
    assert DEFAULT_MAX_STEPS == 2000
