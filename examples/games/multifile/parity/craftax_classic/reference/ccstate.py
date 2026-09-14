"""Decode the driver's canonical state dump, and the game's constants.

The layout is defined once, in cc_ref_driver.c, and printed by `cc_ref
layout`. This module parses that table rather than hard-coding offsets, so a
field added to the dump cannot silently desynchronise the Python side.

Constants mirror craftax_classic.h. They are duplicated here (not parsed) on
purpose: a typo would make a corpus policy ineffective, not wrong, and the
coverage gate is what catches that.
"""

from __future__ import annotations

import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
CC_REF = HERE / "build" / "cc_ref"

MAP_SIZE = 64
NUM_INVENTORY = 12
NUM_ACHIEVEMENTS = 22
MAX_TIMESTEPS = 10000
DAY_LENGTH = 300

(BLK_INVALID, BLK_OUT_OF_BOUNDS, BLK_GRASS, BLK_WATER, BLK_STONE, BLK_TREE,
 BLK_WOOD, BLK_PATH, BLK_COAL, BLK_IRON, BLK_DIAMOND, BLK_TABLE, BLK_FURNACE,
 BLK_SAND, BLK_LAVA, BLK_PLANT, BLK_RIPE_PLANT) = range(17)

(ACT_NOOP, ACT_LEFT, ACT_RIGHT, ACT_UP, ACT_DOWN, ACT_DO, ACT_SLEEP,
 ACT_PLACE_STONE, ACT_PLACE_TABLE, ACT_PLACE_FURNACE, ACT_PLACE_PLANT,
 ACT_MAKE_WOOD_PICK, ACT_MAKE_STONE_PICK, ACT_MAKE_IRON_PICK,
 ACT_MAKE_WOOD_SWORD, ACT_MAKE_STONE_SWORD, ACT_MAKE_IRON_SWORD) = range(17)

NUM_ACTIONS = 17

# inv[] slots
INV_WOOD, INV_STONE, INV_COAL, INV_IRON, INV_DIAMOND, INV_SAPLING = range(6)
INV_WPICK, INV_SPICK, INV_IPICK, INV_WSWORD, INV_SSWORD, INV_ISWORD = range(6, 12)

ACH_NAMES = [
    "collect_wood", "place_table", "eat_cow", "collect_sapling",
    "collect_drink", "make_wood_pick", "make_wood_sword", "place_plant",
    "defeat_zombie", "collect_stone", "place_stone", "eat_plant",
    "defeat_skeleton", "make_stone_pick", "make_stone_sword", "wake_up",
    "place_furnace", "collect_coal", "collect_iron", "collect_diamond",
    "make_iron_pick", "make_iron_sword",
]

# player_dir 1..4, indexing DIR_DR/DIR_DC in the C
DIR_DR = [0, 0, 0, -1, 1]
DIR_DC = [0, -1, 1, 0, 0]
# action -> direction is the identity for 1..4
MOVE_ACTION = {(0, -1): ACT_LEFT, (0, 1): ACT_RIGHT, (-1, 0): ACT_UP, (1, 0): ACT_DOWN}

SOLID = frozenset({BLK_WATER, BLK_STONE, BLK_TREE, BLK_COAL, BLK_IRON,
                   BLK_DIAMOND, BLK_TABLE, BLK_FURNACE, BLK_PLANT, BLK_RIPE_PLANT})

_STRUCT = {"u8": "B", "i8": "b", "u16": "H", "i16": "h", "i32": "i", "u32": "I", "f32": "f"}


@dataclass(frozen=True)
class Field:
    offset: int
    size: int
    type: str
    count: int
    name: str


class Layout:
    """`cc_ref layout`, parsed."""

    def __init__(self, rows: list[Field], total: int):
        self.fields = {f.name: f for f in rows}
        self.order = [f.name for f in rows]
        self.total = total

    @classmethod
    def load(cls) -> "Layout":
        out = subprocess.run([str(CC_REF), "layout"], capture_output=True, check=True).stdout.decode()
        rows, total = [], None
        for line in out.splitlines():
            if line.startswith("#") or line.startswith("offset"):
                continue
            if line.startswith("total "):
                total = int(line.split()[1])
                continue
            off, size, typ, count, name = line.split()
            rows.append(Field(int(off), int(size), typ, int(count), name))
        assert total is not None
        return cls(rows, total)

    def get(self, blob: bytes, name: str):
        f = self.fields[name]
        vals = struct.unpack_from("<" + _STRUCT[f.type] * f.count, blob, f.offset)
        return vals[0] if f.count == 1 else list(vals)

    def raw(self, blob: bytes, name: str) -> bytes:
        f = self.fields[name]
        return blob[f.offset : f.offset + f.size]


class State:
    """A decoded canonical dump. Read-only; built fresh from each dump."""

    __slots__ = ("blob", "L", "_cache")

    def __init__(self, blob: bytes, layout: Layout):
        self.blob = blob
        self.L = layout
        self._cache: dict[str, object] = {}

    def __getattr__(self, name: str):
        if name in self.L.fields:
            if name not in self._cache:
                self._cache[name] = self.L.get(self.blob, name)
            return self._cache[name]
        raise AttributeError(name)

    @property
    def map(self) -> bytes:
        return self.L.raw(self.blob, "map_packed")

    def block(self, r: int, c: int) -> int:
        if not (0 <= r < MAP_SIZE and 0 <= c < MAP_SIZE):
            return BLK_OUT_OF_BOUNDS
        return self.map[r * MAP_SIZE + c]

    def bit_at(self, field: str, r: int, c: int) -> bool:
        """Read one of the per-row occupancy bitmaps. They are stored as two
        uint32 words per row because the JS side holds them that way."""
        if not (0 <= r < MAP_SIZE and 0 <= c < MAP_SIZE):
            return False
        words = self.L.get(self.blob, field)
        lo, hi = words[2 * r], words[2 * r + 1]
        return bool(((hi << 32) | lo) >> c & 1)

    def mob_at(self, r: int, c: int) -> bool:
        return self.bit_at("mob_bits", r, c)

    def zombie_at(self, r: int, c: int) -> bool:
        return self.bit_at("zombie_bits", r, c)

    def cow_at(self, r: int, c: int) -> bool:
        return self.bit_at("cow_bits", r, c)

    def skel_at(self, r: int, c: int) -> bool:
        return self.bit_at("skel_bits", r, c)

    def near_block(self, blk: int) -> bool:
        """is_near_block: the 8 neighbours, not the player's own cell."""
        pr, pc = self.player_r, self.player_c
        for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            if self.block(pr + dr, pc + dc) == blk:
                return True
        return False

    def facing(self) -> tuple[int, int]:
        d = self.player_dir
        return self.player_r + DIR_DR[d], self.player_c + DIR_DC[d]

    def achievements_unlocked(self) -> set[str]:
        return {n for n, v in zip(ACH_NAMES, self.achievements) if v}


class Serve:
    """A `cc_ref serve` session: step the C one action at a time."""

    def __init__(self, seed: int, layout: Layout):
        self.layout = layout
        self.proc = subprocess.Popen(
            [str(CC_REF), "serve", str(seed)], stdin=subprocess.PIPE, stdout=subprocess.PIPE
        )
        nb = struct.unpack("<I", self._read(4))[0]
        assert nb == layout.total, f"serve says {nb} state bytes, layout says {layout.total}"
        self.nb = nb
        self.state = State(self._read(nb), layout)
        self.done = False

    def _read(self, n: int) -> bytes:
        buf = self.proc.stdout.read(n)
        if buf is None or len(buf) != n:
            raise RuntimeError(f"cc_ref serve: short read ({0 if buf is None else len(buf)}/{n})")
        return buf

    def step(self, action: int) -> State:
        assert not self.done, "stepped a finished episode"
        self.proc.stdin.write(bytes([action]))
        self.proc.stdin.flush()
        self.done = self._read(1)[0] == 1
        self.state = State(self._read(self.nb), self.layout)
        return self.state

    def close(self):
        try:
            self.proc.stdin.close()
        except (BrokenPipeError, ValueError):
            pass
        self.proc.wait(timeout=10)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
