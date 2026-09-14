"""The corpus policies of PLAN 4.3.

Random actions never craft an iron sword — across 100 uniform-random episodes
the agent dies in about 180 steps, long before it has a table. So the corpus
mixes five policies, each aimed at code the others never reach. They are
scripted in Python against the C driver's own dumps (`cc_ref serve`), and the
action bytes they produce are what gets committed; the policies themselves are
not part of any gate's ground truth.

A policy is a callable `(serve, rng, max_steps) -> list[int]`.

  uniform     mob movement, spawning, intrinsics decay, death, night
  sticky      walking far: mob despawn at distance 14, map edges
  forager     the tech tree: table, furnace, all six tools, every ore
  adversarial water/sand/lava edges, placing stone on water, plants ripening
  lava        the terminal branch that is neither timeout nor zero health
"""

from __future__ import annotations

import random
from collections import deque

from ccstate import (
    ACT_DO, ACT_DOWN, ACT_LEFT, ACT_MAKE_IRON_PICK, ACT_MAKE_IRON_SWORD,
    ACT_MAKE_STONE_PICK, ACT_MAKE_STONE_SWORD, ACT_MAKE_WOOD_PICK,
    ACT_MAKE_WOOD_SWORD, ACT_NOOP, ACT_PLACE_FURNACE, ACT_PLACE_PLANT,
    ACT_PLACE_STONE, ACT_PLACE_TABLE, ACT_RIGHT, ACT_SLEEP, ACT_UP,
    BLK_COAL, BLK_DIAMOND, BLK_FURNACE, BLK_GRASS, BLK_IRON, BLK_LAVA,
    BLK_PATH, BLK_RIPE_PLANT, BLK_SAND, BLK_STONE, BLK_TABLE, BLK_TREE,
    BLK_WATER, DIR_DC, DIR_DR, INV_COAL, INV_IPICK, INV_IRON, INV_SAPLING,
    INV_SPICK, INV_SSWORD, INV_STONE, INV_ISWORD, INV_WOOD, INV_WPICK,
    INV_WSWORD, MAP_SIZE, MOVE_ACTION, NUM_ACTIONS, SOLID,
)

MOVES = (ACT_LEFT, ACT_RIGHT, ACT_UP, ACT_DOWN)


# --------------------------------------------------------------------------
# the two random policies
# --------------------------------------------------------------------------

def uniform(serve, rng: random.Random, max_steps: int) -> list[int]:
    actions = []
    while not serve.done and len(actions) < max_steps:
        a = rng.randrange(NUM_ACTIONS)
        actions.append(a)
        serve.step(a)
    return actions


def sticky(serve, rng: random.Random, max_steps: int) -> list[int]:
    """Repeat the last action with p=.7, so the walk is ballistic instead of a
    random walk and actually leaves the starting neighbourhood."""
    actions = []
    last = rng.randrange(NUM_ACTIONS)
    while not serve.done and len(actions) < max_steps:
        if rng.random() >= 0.7:
            last = rng.randrange(NUM_ACTIONS)
        actions.append(last)
        serve.step(last)
    return actions


# --------------------------------------------------------------------------
# shared navigation
# --------------------------------------------------------------------------

def passable(st, r: int, c: int) -> bool:
    if not (0 <= r < MAP_SIZE and 0 <= c < MAP_SIZE):
        return False
    b = st.block(r, c)
    return b not in SOLID and b != BLK_LAVA and not st.mob_at(r, c)


def bfs(st, starts, goal_test, avoid_lava_adjacent: bool = False):
    """Shortest path over passable cells from the player. Returns the list of
    cells from the player to the first cell satisfying goal_test, or None."""
    src = (st.player_r, st.player_c)
    if goal_test(src):
        # The player's own cell can be the goal — "already standing next to
        # the water" is the common case, and excluding src made the walker
        # oscillate between two cells that both qualified.
        return [src]
    prev = {src: None}
    q = deque([src])
    while q:
        cur = q.popleft()
        if goal_test(cur):
            path = []
            while cur is not None:
                path.append(cur)
                cur = prev[cur]
            return path[::-1]
        r, c = cur
        for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nxt = (r + dr, c + dc)
            if nxt in prev or not passable(st, *nxt):
                continue
            if avoid_lava_adjacent and any(
                st.block(nxt[0] + a, nxt[1] + b) == BLK_LAVA
                for a, b in ((0, -1), (0, 1), (-1, 0), (1, 0))
            ):
                continue
            prev[nxt] = cur
            q.append(nxt)
    return None


def step_along(path) -> int | None:
    """First move of a path returned by bfs."""
    if not path or len(path) < 2:
        return None
    (r0, c0), (r1, c1) = path[0], path[1]
    return MOVE_ACTION.get((r1 - r0, c1 - c0))


def approach_block(st, blocks, safe: bool = True) -> int | None:
    """Move toward the nearest cell of any type in `blocks`. Those types are
    solid, so the final move does not enter the cell — it turns the player to
    face it, ready for DO."""
    want = set(blocks)
    target = bfs(st, None, lambda cell: any(
        st.block(cell[0] + dr, cell[1] + dc) in want
        for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0))
    ), avoid_lava_adjacent=safe)
    if target is None:
        return None
    if len(target) > 1:
        return step_along(target)
    # Already adjacent: face the block.
    r, c = target[0]
    for (dr, dc), act in MOVE_ACTION.items():
        if st.block(r + dr, c + dc) in want:
            return act
    return None


def minable(st, r: int, c: int, inv) -> bool:
    """Can the player dig through this cell, given the tools in hand?
    Mirrors the do_action switch: stone and coal want any pickaxe, iron wants
    stone or better, diamond wants iron."""
    b = st.block(r, c)
    if b in (BLK_STONE, BLK_COAL):
        return bool(inv[INV_WPICK] or inv[INV_SPICK] or inv[INV_IPICK])
    if b == BLK_IRON:
        return bool(inv[INV_SPICK] or inv[INV_IPICK])
    if b == BLK_DIAMOND:
        return bool(inv[INV_IPICK])
    if b == BLK_TREE:
        return True
    return False


def dig_toward(st, inv, blocks) -> int | None:
    """Route to the nearest block of `blocks`, tunnelling if necessary.

    Plain BFS over passable cells cannot reach ore: a world has one diamond
    and one to three iron cells, and they sit inside stone masses with no
    passable neighbour. This search also steps through cells the player can
    mine, and when the next cell on the path is one of those it returns the
    move that turns to face it — the DO follows on the next tick, because
    moving into a solid cell sets player_dir and stops.
    """
    want = set(blocks)
    src = (st.player_r, st.player_c)
    prev = {src: None}
    q = deque([src])
    goal = None
    while q and goal is None:
        r, c = q.popleft()
        for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nxt = (r + dr, c + dc)
            if nxt in prev or not (0 <= nxt[0] < MAP_SIZE and 0 <= nxt[1] < MAP_SIZE):
                continue
            if st.block(*nxt) in want:
                prev[nxt] = (r, c)
                goal = nxt
                break
            if passable(st, *nxt) or minable(st, nxt[0], nxt[1], inv):
                prev[nxt] = (r, c)
                q.append(nxt)
    if goal is None:
        return None
    path = []
    cur = goal
    while cur is not None:
        path.append(cur)
        cur = prev[cur]
    path.reverse()
    if len(path) < 2:
        return None
    step = path[1]
    if st.block(*step) in want or not passable(st, *step):
        # Solid: the move turns the player to face it; DO comes next tick.
        if step == st.facing():
            return ACT_DO
    return MOVE_ACTION[(step[0] - st.player_r, step[1] - st.player_c)]


def face_free_cell(st) -> int | None:
    """Get into a position where the facing cell is free, so a place_* action
    has somewhere to go.

    place_block writes to the cell the player faces, and the only way to face a
    passable cell is to have walked in that direction. So: find three passable
    cells in a line, walk to the first, and step once. If the player is already
    facing a free cell, no move is needed and this returns None with
    `facing_is_free` true.
    """
    pr, pc = st.player_r, st.player_c
    for d in (1, 2, 3, 4):
        mid = (pr + DIR_DR[d], pc + DIR_DC[d])
        far = (mid[0] + DIR_DR[d], mid[1] + DIR_DC[d])
        if passable(st, *mid) and passable(st, *far):
            return MOVE_ACTION[(DIR_DR[d], DIR_DC[d])]
    return None


def facing_is_free(st) -> bool:
    fr, fc = st.facing()
    if not (0 <= fr < MAP_SIZE and 0 <= fc < MAP_SIZE):
        return False
    return st.block(fr, fc) not in SOLID and st.block(fr, fc) != BLK_LAVA and not st.mob_at(fr, fc)


def facing_mob(st) -> bool:
    return st.mob_at(*st.facing())


def face_adjacent(st, predicate) -> int | None:
    """What to do about an adjacent cell satisfying `predicate`: DO if the
    player already faces one, otherwise the move that turns toward it, else
    None. Moving into an occupied cell sets player_dir and then bails on the
    has_mob_at check, so a move action is how you turn to face a mob without
    walking into it."""
    if predicate(*st.facing()):
        return ACT_DO
    for (dr, dc), act in MOVE_ACTION.items():
        if predicate(st.player_r + dr, st.player_c + dc):
            return act
    return None


# --------------------------------------------------------------------------
# a survival core, shared by the two scripted policies
# --------------------------------------------------------------------------

def flee_from(st, predicate) -> int | None:
    """Step to the adjacent passable cell that maximises distance from the
    nearest cell satisfying `predicate`."""
    threats = [
        (st.player_r + dr, st.player_c + dc)
        for dr in range(-4, 5) for dc in range(-4, 5)
        if predicate(st.player_r + dr, st.player_c + dc)
    ]
    if not threats:
        return None
    best, best_d = None, -1
    for (dr, dc), act in MOVE_ACTION.items():
        nr, nc = st.player_r + dr, st.player_c + dc
        if not passable(st, nr, nc):
            continue
        d = min(abs(nr - tr) + abs(nc - tc) for tr, tc in threats)
        if d > best_d:
            best, best_d = act, d
    return best


def harvest(st, blocks) -> int | None:
    """Approach the nearest block of these types; DO if already facing one.

    The DO case matters more than it looks: approach_block only ever turns the
    player toward the block, so a caller that used it alone would re-face the
    same water tile forever and never drink.
    """
    if st.block(*st.facing()) in blocks:
        return ACT_DO
    return approach_block(st, blocks)


def survive(st, sleep_ok: bool = True) -> int | None:
    """The action needed to not die, or None if nothing is pressing.

    Ordered by how fast the thing kills you. A zombie does 2 damage every 5
    steps from an adjacent cell against 9 health, so it wins in about 25
    steps; food and drink drain on a 20-25 step tick and only start costing
    health once they hit zero; energy is slowest but pins health recovery at
    zero while it is out.
    """
    hostile = lambda r, c: st.zombie_at(r, c) or st.skel_at(r, c)
    a = face_adjacent(st, hostile)
    if a is not None:
        # Trading blows only works while there is health to trade. Up to
        # three zombies spawn at night and each does 2 every 5 steps, so a
        # wood sword (damage 2) loses that race; below half health, walk away
        # instead. Nearly every death in the first version of this policy was
        # a full-health-but-outnumbered brawl.
        if st.health > 4:
            return a
        away = flee_from(st, hostile)
        if away is not None:
            return away
        return a
    # Thresholds are low on purpose. drink and food tick down once every 20
    # to 25 steps and only cost health at zero, so topping up at 7 meant the
    # agent shuttled between the pond and the cows and never went prospecting.
    if st.drink <= 4:
        b = harvest(st, (BLK_WATER,))
        if b is not None:
            return b
    if st.food <= 4:
        if st.block(*st.facing()) == BLK_RIPE_PLANT:
            return ACT_DO
        b = face_adjacent(st, st.cow_at)
        if b is not None:
            return b
        b = harvest(st, (BLK_RIPE_PLANT,))
        if b is None:
            cow = bfs(st, None, lambda cell: any(
                st.cow_at(cell[0] + dr, cell[1] + dc)
                for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0))))
            b = step_along(cow) if cow else None
        if b is not None:
            return b
    if sleep_ok:
        # Never sleep with a zombie in reach: a hit on a sleeping player does
        # 7, not 2, and that is most of the health bar in one tick.
        zombie_near = any(
            st.zombie_at(st.player_r + dr, st.player_c + dc)
            for dr in range(-3, 4) for dc in range(-3, 4)
        )
        sleepy = (st.light_level < 0.15 and st.energy < 9) or st.energy <= 4
        if (sleepy and st.food > 3 and st.drink > 3 and st.health >= 6
                and not zombie_near):
            return ACT_SLEEP
    return None


# --------------------------------------------------------------------------
# scripted forager
# --------------------------------------------------------------------------

# What the iron tools need in one place: a table and a furnace adjacent to the
# player, and one each of wood, stone, iron, coal — per tool. The forager
# gathers a margin above that before building its workshop, because walking
# back for a missing unit is how the first draft kept timing out.
WORKSHOP = {INV_WOOD: 5, INV_STONE: 5, INV_IRON: 2, INV_COAL: 2}


def forager(serve, rng: random.Random, max_steps: int) -> list[int]:
    """Walk the tech tree: wood -> table -> picks -> stone -> furnace ->
    coal/iron -> iron tools -> diamond, drinking, eating and sleeping on the
    way. Greedy and map-omniscient: it reads the C's full map out of the dump.
    That is fine — the corpus has to reach the code, not to be a plausible
    agent."""
    actions = []

    def emit(a):
        if serve.done or len(actions) >= max_steps:
            return
        actions.append(a)
        serve.step(a)

    while not serve.done and len(actions) < max_steps:
        st = serve.state
        inv = st.inv
        ach = st.achievements
        near_table = st.near_block(BLK_TABLE)
        near_furnace = st.near_block(BLK_FURNACE)

        a = survive(st)
        if a is not None:
            emit(a); continue

        # A sapling is a 10% roll per DO on grass, so it needs its own drive
        # rather than being left to the idle branch.
        if inv[INV_SAPLING] < 1 and not ach[7]:                  # ACH_PLACE_PLANT
            if st.block(*st.facing()) == BLK_GRASS:
                emit(ACT_DO); continue

        # Crafting, whenever the preconditions already hold.
        if near_table:
            if not inv[INV_WPICK] and inv[INV_WOOD] >= 1:
                emit(ACT_MAKE_WOOD_PICK); continue
            if not inv[INV_WSWORD] and inv[INV_WOOD] >= 1:
                emit(ACT_MAKE_WOOD_SWORD); continue
            # Sword before pick at the stone tier: a zombie has 5 health, so
            # a wood sword (2 damage) needs three swings and a stone sword
            # (3) needs two. That one step is most of the difference between
            # winning and losing a night.
            if not inv[INV_SSWORD] and inv[INV_WOOD] >= 1 and inv[INV_STONE] >= 1:
                emit(ACT_MAKE_STONE_SWORD); continue
            if not inv[INV_SPICK] and inv[INV_WOOD] >= 1 and inv[INV_STONE] >= 1:
                emit(ACT_MAKE_STONE_PICK); continue
            if near_furnace and inv[INV_WOOD] and inv[INV_STONE] and inv[INV_IRON] and inv[INV_COAL]:
                if not inv[INV_IPICK]:
                    emit(ACT_MAKE_IRON_PICK); continue
                if not inv[INV_ISWORD]:
                    emit(ACT_MAKE_IRON_SWORD); continue

        # Placing. Everything here needs a free cell in front, and the only
        # way to face one is to have walked into it, so face_free_cell moves
        # first and the place happens on the next pass.
        if facing_is_free(st):
            # Wall off when hurt. Zombies only spawn on grass and path and
            # cannot walk through stone, so a placed block is real cover.
            if st.health <= 4 and inv[INV_STONE] >= 1 and any(
                    st.zombie_at(st.player_r + dr, st.player_c + dc)
                    for dr in range(-3, 4) for dc in range(-3, 4)):
                emit(ACT_PLACE_STONE); continue
            if inv[INV_WOOD] >= 2 and not near_table:
                emit(ACT_PLACE_TABLE); continue
            if inv[INV_STONE] >= 1 and near_table and not near_furnace:
                emit(ACT_PLACE_FURNACE); continue
            if inv[INV_SAPLING] >= 1 and st.block(*st.facing()) == BLK_GRASS:
                emit(ACT_PLACE_PLANT); continue
            if inv[INV_STONE] >= 2 and not ach[10]:              # ACH_PLACE_STONE
                emit(ACT_PLACE_STONE); continue

        # Once the ingredients are in hand, build a workshop here rather than
        # walking back to the first table — the return trip is usually what
        # the clock runs out on.
        have_workshop_stock = all(inv[k] >= v for k, v in WORKSHOP.items())
        if have_workshop_stock and not (near_table and near_furnace) and not inv[INV_ISWORD]:
            a = face_free_cell(st)
            if a is not None:
                emit(a); continue

        # Gathering. Order is by scarcity, not by tech tree: a world holds
        # 300-400 trees and one to three iron cells, so "nearest of everything
        # I want" degenerates into farming wood forever. Wood only jumps the
        # queue when there is not enough left to craft with.
        wants = []
        if inv[INV_WOOD] < 2:
            wants.append(BLK_TREE)
        if inv[INV_IPICK] and not ach[19]:                       # ACH_COLLECT_DIAMOND
            wants.append(BLK_DIAMOND)
        # Stone before the rarer ores: it gates the stone pick, which gates
        # iron, and it is the one mineral that is never far away.
        # Enough to craft with, then move on. Holding out for a full
        # workshop's worth of stone starved the later ores: stone gets spent
        # on every tool, so "stone < 5" is almost always true and the queue
        # never advanced past it.
        if inv[INV_WPICK] and inv[INV_STONE] < 2:
            wants.append(BLK_STONE)
        if inv[INV_SPICK] and inv[INV_IRON] < WORKSHOP[INV_IRON]:
            wants.append(BLK_IRON)
        if inv[INV_WPICK] and inv[INV_COAL] < WORKSHOP[INV_COAL]:
            wants.append(BLK_COAL)
        if inv[INV_WPICK] and inv[INV_STONE] < WORKSHOP[INV_STONE]:
            wants.append(BLK_STONE)
        if inv[INV_WOOD] < WORKSHOP[INV_WOOD]:
            wants.append(BLK_TREE)
        # One want at a time, in tech-tree order. Pursuing the whole set at
        # once means always taking the nearest, and trees are everywhere while
        # a world holds one to three iron cells — so the agent farmed wood
        # until it starved and never walked to the ore.
        acted = False
        for want in wants:
            a = harvest(st, (want,)) or dig_toward(st, inv, (want,))
            if a is not None:
                emit(a); acted = True; break
        if acted:
            continue

        # Hunt a skeleton if we have never beaten one; they sit on path cells
        # and the rest of the policy actively avoids those.
        if not ach[12] and (inv[INV_SSWORD] or inv[INV_ISWORD]):  # ACH_DEFEAT_SKELETON
            path = bfs(st, None, lambda cell: any(
                st.skel_at(cell[0] + dr, cell[1] + dc)
                for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0))))
            a = step_along(path)
            if a is not None:
                emit(a); continue

        # Idle: dig grass for a sapling, else wander.
        if st.block(*st.facing()) == BLK_GRASS and inv[INV_SAPLING] < 1:
            emit(ACT_DO); continue
        a = approach_block(st, (BLK_TREE,)) if inv[INV_WOOD] < 9 else None
        emit(a if a is not None else rng.choice(MOVES))

    return actions


# --------------------------------------------------------------------------
# adversarial
# --------------------------------------------------------------------------

def adversarial(serve, rng: random.Random, max_steps: int) -> list[int]:
    """Aim at the edges the other policies miss: place stone into water (the
    one place_block case that overwrites a solid block), plant a sapling and
    wait out the 600 steps to ripe so BLK_RIPE_PLANT and eat_plant happen, and
    loiter where skeletons shoot. It has to survive 600+ steps to do the plant
    part at all, so it runs the same survival core as the forager."""
    actions = []

    def emit(a):
        if serve.done or len(actions) >= max_steps:
            return
        actions.append(a)
        serve.step(a)

    planted_at = None
    while not serve.done and len(actions) < max_steps:
        st = serve.state
        inv = st.inv

        a = survive(st)
        if a is not None:
            emit(a); continue

        # The one place_block branch that overwrites a solid block.
        if inv[INV_STONE] >= 1 and st.block(*st.facing()) == BLK_WATER:
            emit(ACT_PLACE_STONE); continue

        # Minimal tech: wood -> table -> wood pick -> stone, so there is stone
        # to throw into the water.
        if inv[INV_WOOD] < 4:
            a = harvest(st, (BLK_TREE,))
            if a is not None:
                emit(a); continue
        if inv[INV_WOOD] >= 2 and not st.near_block(BLK_TABLE):
            if facing_is_free(st):
                emit(ACT_PLACE_TABLE); continue
            a = face_free_cell(st)
            if a is not None:
                emit(a); continue
        if st.near_block(BLK_TABLE) and not inv[INV_WPICK] and inv[INV_WOOD] >= 1:
            emit(ACT_MAKE_WOOD_PICK); continue
        if inv[INV_WPICK] and inv[INV_STONE] < 3:
            a = harvest(st, (BLK_STONE,))
            if a is not None:
                emit(a); continue

        # Sapling, plant, then stay nearby until it ripens at age 600.
        if inv[INV_SAPLING] < 1 and planted_at is None:
            if st.block(*st.facing()) == BLK_GRASS:
                emit(ACT_DO); continue
            a = approach_block(st, (BLK_TREE,))
            emit(a if a is not None else rng.choice(MOVES))
            continue
        if planted_at is None and inv[INV_SAPLING] >= 1:
            if st.block(*st.facing()) == BLK_GRASS and facing_is_free(st):
                emit(ACT_PLACE_PLANT)
                planted_at = serve.state.facing()
                continue
            a = face_free_cell(st)
            emit(a if a is not None else rng.choice(MOVES))
            continue

        # Planted: eat it the moment it ripens, otherwise stay in the area.
        if planted_at is not None:
            if st.block(*planted_at) == BLK_RIPE_PLANT:
                a = face_adjacent(st, lambda r, c: (r, c) == planted_at)
                if a is not None:
                    emit(a); continue
            if abs(st.player_r - planted_at[0]) + abs(st.player_c - planted_at[1]) > 6:
                path = bfs(st, None, lambda cell:
                           abs(cell[0] - planted_at[0]) + abs(cell[1] - planted_at[1]) <= 2)
                a = step_along(path)
                if a is not None:
                    emit(a); continue
            emit(ACT_NOOP if rng.random() < 0.7 else rng.choice(MOVES))
            continue

        emit(rng.choice(MOVES))

    return actions


# --------------------------------------------------------------------------
# lava walk
# --------------------------------------------------------------------------

def lava(serve, rng: random.Random, max_steps: int) -> list[int]:
    """Find lava and step onto it, for the terminal branch that is neither the
    timestep cap nor zero health. Lava is passable, so walking in works; the
    episode ends because the player is standing on it."""
    actions = []

    def emit(a):
        if serve.done or len(actions) >= max_steps:
            return
        actions.append(a)
        serve.step(a)

    while not serve.done and len(actions) < max_steps:
        st = serve.state
        for (dr, dc), act in MOVE_ACTION.items():
            if st.block(st.player_r + dr, st.player_c + dc) == BLK_LAVA:
                emit(act)
                break
        else:
            path = bfs(st, None, lambda cell: any(
                st.block(cell[0] + dr, cell[1] + dc) == BLK_LAVA
                for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0))))
            a = step_along(path)
            if a is None:
                # No lava reachable from here: stay alive and keep looking.
                a = survive(st, sleep_ok=False) or rng.choice(MOVES)
            emit(a)
    return actions


POLICIES = {
    "uniform": (uniform, 100),
    "sticky": (sticky, 50),
    "forager": (forager, 30),
    "adversarial": (adversarial, 20),
    "lava": (lava, 10),
}
