// 10_constants.js — the C's constants, mirrored.
//
// Every name here is the craftax_classic.h name with the same value. They are
// duplicated rather than derived because a wrong constant is a divergence,
// and the layout gate plus G1/G2 are what catch one.

const MAP_SIZE = 64;
const MAP_PACKED_ROW = MAP_SIZE;
const MAP_PACKED_SIZE = MAP_SIZE * MAP_PACKED_ROW;

const MAX_ZOMBIES = 3;
const MAX_COWS = 3;
const MAX_SKELETONS = 2;
const MAX_ARROWS = 3;
const MAX_PLANTS = 10;
const NUM_ACHIEVEMENTS = 22;
const NUM_ACTIONS = 17;
const NUM_BLOCK_TYPES = 17;
const NUM_INVENTORY = 12;
const OBS_DIM = 1345;
const MAX_TIMESTEPS = 10000;
const DAY_LENGTH = 300;
const MOB_DESPAWN_DIST = 14;

// Block types. 17 of them, so one per byte: a nibble holds 0..15 and would
// turn every BLK_RIPE_PLANT into BLK_INVALID, which is the bug the C's own
// comment at MAP_PACKED_ROW records.
const BLK_INVALID = 0;
const BLK_OUT_OF_BOUNDS = 1;
const BLK_GRASS = 2;
const BLK_WATER = 3;
const BLK_STONE = 4;
const BLK_TREE = 5;
const BLK_WOOD = 6;
const BLK_PATH = 7;
const BLK_COAL = 8;
const BLK_IRON = 9;
const BLK_DIAMOND = 10;
const BLK_TABLE = 11;
const BLK_FURNACE = 12;
const BLK_SAND = 13;
const BLK_LAVA = 14;
const BLK_PLANT = 15;
const BLK_RIPE_PLANT = 16;

// Actions. These indices are also the sidecar's action indices, so an action
// file is valid for the C and the JS with no mapping.
const ACT_NOOP = 0;
const ACT_LEFT = 1;
const ACT_RIGHT = 2;
const ACT_UP = 3;
const ACT_DOWN = 4;
const ACT_DO = 5;
const ACT_SLEEP = 6;
const ACT_PLACE_STONE = 7;
const ACT_PLACE_TABLE = 8;
const ACT_PLACE_FURNACE = 9;
const ACT_PLACE_PLANT = 10;
const ACT_MAKE_WOOD_PICK = 11;
const ACT_MAKE_STONE_PICK = 12;
const ACT_MAKE_IRON_PICK = 13;
const ACT_MAKE_WOOD_SWORD = 14;
const ACT_MAKE_STONE_SWORD = 15;
const ACT_MAKE_IRON_SWORD = 16;

// Achievements, indices into the achievements array.
const ACH_COLLECT_WOOD = 0;
const ACH_PLACE_TABLE = 1;
const ACH_EAT_COW = 2;
const ACH_COLLECT_SAPLING = 3;
const ACH_COLLECT_DRINK = 4;
const ACH_MAKE_WOOD_PICK = 5;
const ACH_MAKE_WOOD_SWORD = 6;
const ACH_PLACE_PLANT = 7;
const ACH_DEFEAT_ZOMBIE = 8;
const ACH_COLLECT_STONE = 9;
const ACH_PLACE_STONE = 10;
const ACH_EAT_PLANT = 11;
const ACH_DEFEAT_SKELETON = 12;
const ACH_MAKE_STONE_PICK = 13;
const ACH_MAKE_STONE_SWORD = 14;
const ACH_WAKE_UP = 15;
const ACH_PLACE_FURNACE = 16;
const ACH_COLLECT_COAL = 17;
const ACH_COLLECT_IRON = 18;
const ACH_COLLECT_DIAMOND = 19;
const ACH_MAKE_IRON_PICK = 20;
const ACH_MAKE_IRON_SWORD = 21;

const ACH_NAMES = [
  'collect_wood', 'place_table', 'eat_cow', 'collect_sapling',
  'collect_drink', 'make_wood_pick', 'make_wood_sword', 'place_plant',
  'defeat_zombie', 'collect_stone', 'place_stone', 'eat_plant',
  'defeat_skeleton', 'make_stone_pick', 'make_stone_sword', 'wake_up',
  'place_furnace', 'collect_coal', 'collect_iron', 'collect_diamond',
  'make_iron_pick', 'make_iron_sword',
];

// Inventory slots, in the C's order.
const INV_WOOD = 0;
const INV_STONE = 1;
const INV_COAL = 2;
const INV_IRON = 3;
const INV_DIAMOND = 4;
const INV_SAPLING = 5;
const INV_WPICK = 6;
const INV_SPICK = 7;
const INV_IPICK = 8;
const INV_WSWORD = 9;
const INV_SSWORD = 10;
const INV_ISWORD = 11;

// Direction tables. Index by player_dir, which is 1..4; slot 0 is the C's
// unused padding entry and must stay, because player_dir is read straight
// into these arrays.
const DIR_DR = [0, 0, 0, -1, 1];
const DIR_DC = [0, -1, 1, 0, 0];
