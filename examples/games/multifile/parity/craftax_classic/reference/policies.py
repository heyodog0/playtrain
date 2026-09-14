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


def threats_near(st, radius: int = 3) -> bool:
    return any(
        st.zombie_at(st.player_r + dr, st.player_c + dc)
        or st.skel_at(st.player_r + dr, st.player_c + dc)
        for dr in range(-radius, radius + 1)
        for dc in range(-radius, radius + 1)
    )


def survive(st, sleep_ok: bool = True) -> int | None:
    """The action needed to not die, or None if nothing is pressing.

    Ordered by how fast the thing kills you. A zombie has 5 health and does 2
    damage every 5 steps from an adjacent cell; against 9 health and a wood
    sword (2 damage, so three swings) that is a fight the player loses, which
    is what killed every early version of the forager at full food and water.
    So: fight only with a stone sword or better, otherwise walk away.
    """
    hostile = lambda r, c: st.zombie_at(r, c) or st.skel_at(r, c)
    inv = st.inv

    a = face_adjacent(st, hostile)
    if a is not None:
        # Fight, almost always. Fleeing looks safer and is not: a zombie
        # closes with p=0.75 every step, so it moves as fast as the player
        # and running only postpones the same fight with less health. The
        # arithmetic favours attacking — a zombie's attack cooldown is 5
        # steps, so killing one takes 2 or 3 swings and costs about 2 damage.
        # Only back off at the very end, when one more hit is fatal and there
        # is somewhere to go.
        if st.health <= 2:
            away = flee_from(st, hostile)
            if away is not None:
                return away
        return a

    # Topping up starts well before zero because reaching the water or
    # catching a cow takes tens of steps, and a cow walks away while you do
    # it. Waiting until 4 meant the agent was already starving by the time it
    # set off.
    if st.drink <= 6:
        b = harvest(st, (BLK_WATER,))
        if b is not None:
            return b
    if st.food <= 6:
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
        # Sleep is the ONLY way energy comes back (fatigue < -10 in
        # update_intrinsics), and energy 0 stops health recovering. Gating
        # sleep on food and drink created a death spiral: hungry, so no
        # sleep; no sleep, so no energy; no energy, so no healing.
        sleepy = (st.light_level < 0.15 and st.energy < 9) or st.energy <= 4
        if sleepy and st.health >= 4 and not threats_near(st):
            return ACT_SLEEP
    return None


def rest(st) -> int | None:
    """Stand still to heal. recover climbs by 1 a step while food, drink and
    energy are all above zero, and every 25 of it is one health back. Doing
    nothing is the only way to heal in Classic, and a forager that never
    pauses arrives at the ore field on 2 health."""
    if st.health >= 9 or threats_near(st, 4):
        return None
    if st.food > 4 and st.drink > 4 and st.energy > 0:
        return ACT_NOOP
    return None


# --------------------------------------------------------------------------
# scripted forager
# --------------------------------------------------------------------------

# Phases run in this order and never go backwards. An earlier draft recomputed
# the goal from inventory every tick, and that oscillated: one step toward the
# stone would drop wood below its threshold, the next step went back to a
# tree, and the agent spent 500 steps between the two and died in the middle.
# A phase variable that only advances is what stopped it.
PHASES = [
    "wood",       # 5 wood
    "table",      # table down, wood pick and wood sword made
    "stone",      # 3 stone mined
    "tools",      # stone sword, stone pick, a furnace and a placed stone
    "coal",       # 2 coal
    "iron",       # 2 iron
    "workshop",   # table + furnace adjacent, with wood and stone to spare
    "irontools",  # iron pick and iron sword
    "diamond",    # the map's single diamond
    "skeleton",   # one skeleton killed; they only exist near mined stone
    "idle",       # stay alive, which is also the only route to the step cap
]


def forager(serve, rng: random.Random, max_steps: int) -> list[int]:
    """Walk the whole tech tree as a monotonic phase machine.

    Greedy and map-omniscient: it reads the C's full map out of the dump.
    That is fine — the corpus has to reach the code, not be a plausible agent.
    Every ore is within about 35 cells of spawn, tunnelling included, so the
    binding constraint is never distance; it is not wasting steps and not
    dying on the way.
    """
    actions = []
    phase = 0

    def emit(a):
        if serve.done or len(actions) >= max_steps:
            return
        actions.append(a)
        serve.step(a)

    def mine(block):
        st = serve.state
        return harvest(st, (block,)) or dig_toward(st, st.inv, (block,))

    def place(action):
        """Place a block; if the facing cell is occupied, step to free one."""
        if facing_is_free(serve.state):
            emit(action)
            return True
        mv = face_free_cell(serve.state)
        if mv is not None:
            emit(mv)
            return True
        return False

    while not serve.done and len(actions) < max_steps:
        st = serve.state
        inv = st.inv
        ach = st.achievements
        near_table = st.near_block(BLK_TABLE)
        near_furnace = st.near_block(BLK_FURNACE)
        name = PHASES[phase]

        # --- interrupts, before any phase logic ---------------------------
        a = survive(st)
        if a is not None:
            emit(a); continue
        # Healing is an interrupt too, not just something the idle phase does.
        # Standing still is the only way health comes back, and a phase
        # machine that never pauses arrives at the ore field on 2 health.
        if st.health <= 5:
            a = rest(st)
            if a is not None:
                emit(a); continue
        if inv[INV_SAPLING] < 1 and not ach[3] and st.block(*st.facing()) == BLK_GRASS:
            emit(ACT_DO); continue                       # ACH_COLLECT_SAPLING
        if inv[INV_SAPLING] >= 1 and not ach[7] and st.block(*st.facing()) == BLK_GRASS:
            emit(ACT_PLACE_PLANT); continue              # ACH_PLACE_PLANT

        # --- phase goals ---------------------------------------------------
        if name == "wood":
            if inv[INV_WOOD] >= 5:
                phase += 1; continue
            a = mine(BLK_TREE)
            emit(a if a is not None else rng.choice(MOVES)); continue

        if name == "table":
            if inv[INV_WPICK] and inv[INV_WSWORD]:
                phase += 1; continue
            if near_table:
                if not inv[INV_WPICK] and inv[INV_WOOD] >= 1:
                    emit(ACT_MAKE_WOOD_PICK); continue
                if not inv[INV_WSWORD] and inv[INV_WOOD] >= 1:
                    emit(ACT_MAKE_WOOD_SWORD); continue
                a = mine(BLK_TREE)
                emit(a if a is not None else rng.choice(MOVES)); continue
            if inv[INV_WOOD] >= 2:
                if place(ACT_PLACE_TABLE):
                    continue
            a = mine(BLK_TREE)
            emit(a if a is not None else rng.choice(MOVES)); continue

        if name == "stone":
            if inv[INV_STONE] >= 3:
                phase += 1; continue
            a = mine(BLK_STONE)
            emit(a if a is not None else rng.choice(MOVES)); continue

        if name == "tools":
            # Needs a table again, and this is usually far from the first one,
            # so build a second rather than walk back.
            if inv[INV_SPICK] and inv[INV_SSWORD] and ach[16] and ach[10]:
                phase += 1; continue                     # PLACE_FURNACE, PLACE_STONE
            if inv[INV_WOOD] < 2:
                a = mine(BLK_TREE)
                emit(a if a is not None else rng.choice(MOVES)); continue
            if inv[INV_STONE] < 2:
                a = mine(BLK_STONE)
                emit(a if a is not None else rng.choice(MOVES)); continue
            if not near_table:
                if place(ACT_PLACE_TABLE):
                    continue
            if not inv[INV_SSWORD]:
                emit(ACT_MAKE_STONE_SWORD); continue
            if not inv[INV_SPICK]:
                emit(ACT_MAKE_STONE_PICK); continue
            if not ach[16] and place(ACT_PLACE_FURNACE):
                continue
            if not ach[10] and place(ACT_PLACE_STONE):
                continue
            phase += 1; continue

        if name in ("coal", "iron"):
            block, slot = (BLK_COAL, INV_COAL) if name == "coal" else (BLK_IRON, INV_IRON)
            if inv[slot] >= 2:
                phase += 1; continue
            a = mine(block)
            if a is None:
                phase += 1; continue                     # none left on this map
            emit(a); continue

        if name == "workshop":
            if near_table and near_furnace and inv[INV_WOOD] >= 2 and inv[INV_STONE] >= 2:
                phase += 1; continue
            # Walk back to a table and furnace that are already standing
            # before spending 4 wood and 4 stone building a second pair. The
            # tools phase leaves exactly such a pair behind, and the return
            # trip is about 35 cells — cheaper than re-gathering, and it is
            # the step that the iron tools were never reaching.
            if not (near_table and near_furnace):
                back = bfs(st, None, lambda cell: any(
                    st.block(cell[0] + dr, cell[1] + dc) == BLK_TABLE
                    for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (-1, 1), (1, -1), (1, 1))
                ) and any(
                    st.block(cell[0] + dr, cell[1] + dc) == BLK_FURNACE
                    for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0), (-1, -1), (-1, 1), (1, -1), (1, 1))
                ))
                a = step_along(back)
                if a is not None:
                    emit(a); continue
            if inv[INV_WOOD] < 4:
                a = mine(BLK_TREE)
                emit(a if a is not None else rng.choice(MOVES)); continue
            if inv[INV_STONE] < 4:
                a = mine(BLK_STONE)
                emit(a if a is not None else rng.choice(MOVES)); continue
            if not near_table and place(ACT_PLACE_TABLE):
                continue
            if not near_furnace and place(ACT_PLACE_FURNACE):
                continue
            phase += 1; continue

        if name == "irontools":
            if (inv[INV_IPICK] and inv[INV_ISWORD]) or not (inv[INV_IRON] and inv[INV_COAL]):
                phase += 1; continue
            if not (near_table and near_furnace):
                phase -= 1; continue                     # workshop got left behind
            if inv[INV_WOOD] < 1 or inv[INV_STONE] < 1:
                a = mine(BLK_TREE if inv[INV_WOOD] < 1 else BLK_STONE)
                emit(a if a is not None else rng.choice(MOVES)); continue
            emit(ACT_MAKE_IRON_PICK if not inv[INV_IPICK] else ACT_MAKE_IRON_SWORD)
            continue

        if name == "diamond":
            if ach[19] or not inv[INV_IPICK]:            # ACH_COLLECT_DIAMOND
                phase += 1; continue
            a = mine(BLK_DIAMOND)
            if a is None:
                phase += 1; continue
            emit(a); continue

        if name == "skeleton":
            if ach[12]:                                  # ACH_DEFEAT_SKELETON
                phase += 1; continue
            path = bfs(st, None, lambda cell: any(
                st.skel_at(cell[0] + dr, cell[1] + dc)
                for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0))))
            a = step_along(path)
            if a is not None:
                emit(a); continue
            # None about: mine stone to make more path for them to spawn on.
            a = mine(BLK_STONE)
            emit(a if a is not None else rng.choice(MOVES)); continue

        # idle: heal, keep the plant company, and run out the clock
        a = rest(st)
        if a is not None:
            emit(a); continue
        if st.block(*st.facing()) == BLK_RIPE_PLANT:
            emit(ACT_DO); continue
        emit(ACT_NOOP if rng.random() < 0.7 else rng.choice(MOVES))

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
