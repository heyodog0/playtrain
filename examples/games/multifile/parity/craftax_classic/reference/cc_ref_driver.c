// cc_ref_driver.c — the reference harness for the Craftax-Classic parity port.
//
// Compiles games/craftax_src/craftax_classic.h UNMODIFIED (see build.sh for the
// flags that pin the scalar, no-FMA, V8-ieee754 build) and drives it in four
// modes so the JS port can be judged against it:
//
//   cc_ref layout
//       print the canonical state layout (offset, size, type, field), one row
//       per field, then the total. src/20_state.js and common/parity.js must
//       agree with this table byte for byte.
//
//   cc_ref rng <seed> <n>
//       n lines: "<pcg_out> <rf_bits> <ri4> <ri8> <ri64>" from a stream seeded
//       exactly as c_init seeds it (including the 8 warm-up draws). Every
//       column is derived from the SAME draw. rf_bits is the float32 of cr_rf
//       as a hex u32 so the comparison is on bits, not on a printed decimal.
//       The three ri columns are the moduli G0 asks for.
//
//   cc_ref world <seed>
//       one canonical state dump (binary, CC_STATE_BYTES) straight after
//       generate_world, before any step. Its leading fields are the 4096 map
//       bytes and the player/intrinsics block that PLAN 4.2 asks for; emitting
//       the whole canonical record instead of a subset costs nothing and keeps
//       one serializer on each side.
//
//   cc_ref serve <seed>
//       interactive: play the env one action at a time so a Python policy can
//       decide its next move from the C's own state. Writes u32 state_bytes
//       then the initial canonical state; thereafter reads one action byte
//       from stdin and writes u8 done followed by the canonical state. This is
//       how the scripted corpus policies of PLAN 4.3 are driven. Like run
//       mode, it steps with cc_step_no_reset, so the terminal state survives.
//
//   cc_ref run <seed> <actions.bin> [--dump-every K]
//       steps the env once per byte of actions.bin and writes a binary stream:
//         magic "CCR1", u32 state_bytes, u32 n_steps,
//         then per step: u64 fnv1a64(canonical state), u32 reward float bits,
//         u8 done, u8 has_dump, [state_bytes of canonical state if has_dump].
//       has_dump is set every K steps (K=0 disables) and always on the step
//       where done fires.
//
// ------------------------------------------------------------------------
// Why this file re-states puf_step's body
// ------------------------------------------------------------------------
// puf_step AUTO-RESETS on the terminal step: it calls add_log then puf_reset,
// which runs generate_world and destroys exactly the state the parity gate
// needs to compare for that step. The reference is not editable and the reset
// cannot be interposed (renaming puf_reset with -D renames its definition and
// its call site to the same name, so there is no seam).
//
// So the driver carries cc_step_no_reset: a transcription of puf_step
// (craftax_classic.h lines 957-1009) with the terminal branch replaced by
// "record done and stop". Every other line is the same call in the same order.
//
// A transcription that drifts from the reference would silently corrupt the
// gate, so it is never trusted: run mode keeps a SHADOW env stepped by the real
// puf_step alongside, and after every non-terminal step asserts that the two
// envs produce identical canonical state, identical reward bits and identical
// done. The first mismatch aborts with a non-zero exit. On the terminal step
// the shadow has auto-reset, so only reward bits and done are cross-checked;
// the state comes from cc_step_no_reset. The transcription is therefore
// validated against the real puf_step on every single step it is used for,
// except the one step where the real function cannot answer.
//
// Read this file side by side with craftax_classic.h. It is meant to be short.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>

// V8's ieee754, the same object the QuickJS host binds Math.cos/Math.sin to
// (native/runtime/jsmath.h). The reference's cosf/sinf are redirected here so
// the C's transcendentals are the JS engine's, which is the parity target
// PLAN 1.4 states. ieee754.cc has C++ linkage on purpose (see
// native/runtime/jsmath.h), so v8_shim.cc gives it a C entry point.
double cc_ieee754_cos(double);
double cc_ieee754_sin(double);
static float pt_cosf(float x) { return (float)cc_ieee754_cos((double)x); }
static float pt_sinf(float x) { return (float)cc_ieee754_sin((double)x); }

// The redirect is a macro HERE rather than -Dcosf=pt_cosf on the command line,
// and <math.h> above is included first on purpose. glibc's math.h builds the
// name __DECL_SIMD_cosf by token-pasting __DECL_SIMD_ onto the function name;
// with the name already rewritten on the command line it pastes
// __DECL_SIMD_pt_cosf, which does not exist, and the build dies inside
// /usr/include/math.h. (Apple's libc does not do this, so the command-line
// form worked on the Mac and only broke on FASRC.) Declaring math.h's own
// prototypes first, then defining the macros, redirects every call site in
// craftax_classic.h and leaves the system header alone.
#define cosf pt_cosf
#define sinf pt_sinf

#include "craftax_classic.h"

// ============================================================
// Canonical state layout
// ============================================================
// The Env fields PLAN 1.1 calls state, in declaration order, fixed width, no
// padding, little-endian, with the step's reward appended. uint64 bitmaps and
// the PCG state are written as two uint32 words (lo, hi) because the JS side
// holds them that way and never uses BigInt.

enum { CC_T_U8 = 0, CC_T_I8, CC_T_U16, CC_T_I16, CC_T_I32, CC_T_U32, CC_T_F32 };
static const char* CC_T_NAME[] = {"u8", "i8", "u16", "i16", "i32", "u32", "f32"};
static const int   CC_T_SIZE[] = {1, 1, 2, 2, 4, 4, 4};

typedef struct { const char* name; int type; int count; } CcField;

// Keep in the same order as struct Env. u64 arrays appear as 2*N u32 words.
static const CcField CC_FIELDS[] = {
    {"pcg",           CC_T_U32, 2},
    {"map_packed",    CC_T_U8,  MAP_PACKED_SIZE},
    {"mob_bits",      CC_T_U32, 2 * MAP_SIZE},
    {"zombie_bits",   CC_T_U32, 2 * MAP_SIZE},
    {"cow_bits",      CC_T_U32, 2 * MAP_SIZE},
    {"skel_bits",     CC_T_U32, 2 * MAP_SIZE},
    {"arrow_bits",    CC_T_U32, 2 * MAP_SIZE},
    {"player_r",      CC_T_I16, 1},
    {"player_c",      CC_T_I16, 1},
    {"player_dir",    CC_T_I8,  1},
    {"health",        CC_T_I8,  1},
    {"food",          CC_T_I8,  1},
    {"drink",         CC_T_I8,  1},
    {"energy",        CC_T_I8,  1},
    {"is_sleeping",   CC_T_U8,  1},
    {"recover",       CC_T_F32, 1},
    {"hunger",        CC_T_F32, 1},
    {"thirst",        CC_T_F32, 1},
    {"fatigue",       CC_T_F32, 1},
    {"inv",           CC_T_I8,  NUM_INVENTORY},
    {"zombie_r",      CC_T_I16, MAX_ZOMBIES},
    {"zombie_c",      CC_T_I16, MAX_ZOMBIES},
    {"zombie_hp",     CC_T_I8,  MAX_ZOMBIES},
    {"zombie_cd",     CC_T_I8,  MAX_ZOMBIES},
    {"zombie_mask",   CC_T_U8,  MAX_ZOMBIES},
    {"cow_r",         CC_T_I16, MAX_COWS},
    {"cow_c",         CC_T_I16, MAX_COWS},
    {"cow_hp",        CC_T_I8,  MAX_COWS},
    {"cow_mask",      CC_T_U8,  MAX_COWS},
    {"skel_r",        CC_T_I16, MAX_SKELETONS},
    {"skel_c",        CC_T_I16, MAX_SKELETONS},
    {"skel_hp",       CC_T_I8,  MAX_SKELETONS},
    {"skel_cd",       CC_T_I8,  MAX_SKELETONS},
    {"skel_mask",     CC_T_U8,  MAX_SKELETONS},
    {"arrow_r",       CC_T_I16, MAX_ARROWS},
    {"arrow_c",       CC_T_I16, MAX_ARROWS},
    {"arrow_dr",      CC_T_I8,  MAX_ARROWS},
    {"arrow_dc",      CC_T_I8,  MAX_ARROWS},
    {"arrow_mask",    CC_T_U8,  MAX_ARROWS},
    {"plant_r",       CC_T_I16, MAX_PLANTS},
    {"plant_c",       CC_T_I16, MAX_PLANTS},
    {"plant_age",     CC_T_I16, MAX_PLANTS},
    {"plant_mask",    CC_T_U8,  MAX_PLANTS},
    {"light_level",   CC_T_F32, 1},
    {"achievements",  CC_T_U8,  NUM_ACHIEVEMENTS},
    {"timestep",      CC_T_I32, 1},
    {"reward",        CC_T_F32, 1},
};
#define CC_NUM_FIELDS ((int)(sizeof(CC_FIELDS) / sizeof(CC_FIELDS[0])))

static int cc_state_bytes(void) {
    int n = 0;
    for (int i = 0; i < CC_NUM_FIELDS; i++) n += CC_T_SIZE[CC_FIELDS[i].type] * CC_FIELDS[i].count;
    return n;
}

// --- little-endian writers -------------------------------------------------
typedef struct { unsigned char* p; int n; int cap; } CcBuf;
static void w_u8 (CcBuf* b, uint8_t v)  { b->p[b->n++] = v; }
static void w_i8 (CcBuf* b, int8_t v)   { w_u8(b, (uint8_t)v); }
static void w_u16(CcBuf* b, uint16_t v) { w_u8(b, v & 0xff); w_u8(b, (v >> 8) & 0xff); }
static void w_i16(CcBuf* b, int16_t v)  { w_u16(b, (uint16_t)v); }
static void w_u32(CcBuf* b, uint32_t v) { w_u16(b, v & 0xffff); w_u16(b, (v >> 16) & 0xffff); }
static void w_i32(CcBuf* b, int32_t v)  { w_u32(b, (uint32_t)v); }
static void w_f32(CcBuf* b, float v)    { uint32_t u; memcpy(&u, &v, 4); w_u32(b, u); }
static void w_u64(CcBuf* b, uint64_t v) { w_u32(b, (uint32_t)(v & 0xffffffffu)); w_u32(b, (uint32_t)(v >> 32)); }

// Serialize env + the step's reward. Must match common/parity.js exactly.
static void cc_serialize(const CraftaxClassic* e, float reward, unsigned char* out) {
    CcBuf b = {out, 0, 0};
    w_u64(&b, e->pcg);
    for (int i = 0; i < MAP_PACKED_SIZE; i++) w_u8(&b, e->map_packed[i]);
    for (int i = 0; i < MAP_SIZE; i++) w_u64(&b, e->mob_bits[i]);
    for (int i = 0; i < MAP_SIZE; i++) w_u64(&b, e->zombie_bits[i]);
    for (int i = 0; i < MAP_SIZE; i++) w_u64(&b, e->cow_bits[i]);
    for (int i = 0; i < MAP_SIZE; i++) w_u64(&b, e->skel_bits[i]);
    for (int i = 0; i < MAP_SIZE; i++) w_u64(&b, e->arrow_bits[i]);
    w_i16(&b, e->player_r);
    w_i16(&b, e->player_c);
    w_i8 (&b, e->player_dir);
    w_i8 (&b, e->health);
    w_i8 (&b, e->food);
    w_i8 (&b, e->drink);
    w_i8 (&b, e->energy);
    w_u8 (&b, e->is_sleeping ? 1 : 0);
    w_f32(&b, e->recover);
    w_f32(&b, e->hunger);
    w_f32(&b, e->thirst);
    w_f32(&b, e->fatigue);
    for (int i = 0; i < NUM_INVENTORY; i++)  w_i8(&b, e->inv[i]);
    for (int i = 0; i < MAX_ZOMBIES; i++)    w_i16(&b, e->zombie_r[i]);
    for (int i = 0; i < MAX_ZOMBIES; i++)    w_i16(&b, e->zombie_c[i]);
    for (int i = 0; i < MAX_ZOMBIES; i++)    w_i8 (&b, e->zombie_hp[i]);
    for (int i = 0; i < MAX_ZOMBIES; i++)    w_i8 (&b, e->zombie_cd[i]);
    for (int i = 0; i < MAX_ZOMBIES; i++)    w_u8 (&b, e->zombie_mask[i] ? 1 : 0);
    for (int i = 0; i < MAX_COWS; i++)       w_i16(&b, e->cow_r[i]);
    for (int i = 0; i < MAX_COWS; i++)       w_i16(&b, e->cow_c[i]);
    for (int i = 0; i < MAX_COWS; i++)       w_i8 (&b, e->cow_hp[i]);
    for (int i = 0; i < MAX_COWS; i++)       w_u8 (&b, e->cow_mask[i] ? 1 : 0);
    for (int i = 0; i < MAX_SKELETONS; i++)  w_i16(&b, e->skel_r[i]);
    for (int i = 0; i < MAX_SKELETONS; i++)  w_i16(&b, e->skel_c[i]);
    for (int i = 0; i < MAX_SKELETONS; i++)  w_i8 (&b, e->skel_hp[i]);
    for (int i = 0; i < MAX_SKELETONS; i++)  w_i8 (&b, e->skel_cd[i]);
    for (int i = 0; i < MAX_SKELETONS; i++)  w_u8 (&b, e->skel_mask[i] ? 1 : 0);
    for (int i = 0; i < MAX_ARROWS; i++)     w_i16(&b, e->arrow_r[i]);
    for (int i = 0; i < MAX_ARROWS; i++)     w_i16(&b, e->arrow_c[i]);
    for (int i = 0; i < MAX_ARROWS; i++)     w_i8 (&b, e->arrow_dr[i]);
    for (int i = 0; i < MAX_ARROWS; i++)     w_i8 (&b, e->arrow_dc[i]);
    for (int i = 0; i < MAX_ARROWS; i++)     w_u8 (&b, e->arrow_mask[i] ? 1 : 0);
    for (int i = 0; i < MAX_PLANTS; i++)     w_i16(&b, e->plant_r[i]);
    for (int i = 0; i < MAX_PLANTS; i++)     w_i16(&b, e->plant_c[i]);
    for (int i = 0; i < MAX_PLANTS; i++)     w_i16(&b, e->plant_age[i]);
    for (int i = 0; i < MAX_PLANTS; i++)     w_u8 (&b, e->plant_mask[i] ? 1 : 0);
    w_f32(&b, e->light_level);
    for (int i = 0; i < NUM_ACHIEVEMENTS; i++) w_u8(&b, e->achievements[i] ? 1 : 0);
    w_i32(&b, e->timestep);
    w_f32(&b, reward);
    if (b.n != cc_state_bytes()) {
        fprintf(stderr, "cc_ref: serializer wrote %d bytes, layout says %d\n", b.n, cc_state_bytes());
        exit(2);
    }
}

static uint64_t fnv1a64(const unsigned char* p, int n) {
    uint64_t h = 1469598103934665603ULL;
    for (int i = 0; i < n; i++) { h ^= (uint64_t)p[i]; h *= 1099511628211ULL; }
    return h;
}

// ============================================================
// Env construction
// ============================================================
static void cc_alloc_agent(CraftaxClassic* env) {
    env->agents[0].observations = (obs_t*)calloc(OBS_SIZE, sizeof(obs_t));
    env->agents[0].actions      = (float*)calloc(1, sizeof(float));
    env->agents[0].rewards      = (float*)calloc(1, sizeof(float));
    env->agents[0].terminals    = (float*)calloc(1, sizeof(float));
    env->agents[0].action_mask  = NULL;
    env->agents[0].policy       = 0;
    if (!env->agents[0].observations || !env->agents[0].actions
        || !env->agents[0].rewards || !env->agents[0].terminals) {
        fprintf(stderr, "cc_ref: out of memory\n");
        exit(2);
    }
}

// Fresh env for seed s, exactly as PLAN 3.4 defines "episode with seed s":
// env->rng = s, then c_init (via puf_init), then puf_reset.
static CraftaxClassic* cc_new(unsigned int seed) {
    CraftaxClassic* env = (CraftaxClassic*)calloc(1, sizeof(CraftaxClassic));
    if (!env) { fprintf(stderr, "cc_ref: out of memory\n"); exit(2); }
    cc_alloc_agent(env);
    env->rng = seed;
    puf_init(env, NULL);
    puf_reset(env);
    return env;
}

// ============================================================
// cc_step_no_reset — craftax_classic.h lines 957-1009, minus the auto-reset
// ============================================================
// Line-for-line with puf_step. The only change is the final branch: where the
// reference calls add_log + puf_reset, this records done and returns. Every
// call and every expression above that point is identical, in the same order,
// so the RNG stream is identical.
static void cc_step_no_reset(CraftaxClassic* env, int action, float* out_reward, bool* out_done) {
    env->agents[0].rewards[0]   = 0.0f;
    env->agents[0].terminals[0] = 0.0f;

    if (action < 0) action = 0;
    if (action >= NUM_ACTIONS) action = NUM_ACTIONS - 1;

    env->old_health = env->health;
    memcpy(env->old_achievements, env->achievements, sizeof(env->achievements));

    int eff_action = env->is_sleeping ? ACT_NOOP : action;
    do_crafting(env, eff_action);
    if (eff_action == ACT_DO) do_action(env);
    if (eff_action >= ACT_PLACE_STONE && eff_action <= ACT_PLACE_PLANT) place_block(env, eff_action);
    move_player(env, eff_action);
    update_mobs(env);
    spawn_mobs(env);
    update_plants(env);
    update_intrinsics(env, action);

    for (int i = 0; i < NUM_INVENTORY; i++)
        env->inv[i] = (int8_t)cr_clamp_i(env->inv[i], 0, 9);

    env->timestep++;
    float t_frac = fmodf((float)env->timestep / (float)DAY_LENGTH, 1.0f) + 0.3f;
    float cv = cosf(3.14159265f * t_frac);
    env->light_level = 1.0f - fabsf(cv * cv * cv);

    float ach_r = 0.0f;
    for (int i = 0; i < NUM_ACHIEVEMENTS; i++)
        ach_r += (float)(env->achievements[i] && !env->old_achievements[i]);
    float hp_r = (float)(env->health - env->old_health) * 0.1f;
    float r = ach_r + hp_r;
    env->agents[0].rewards[0] = r;
    env->episode_return_accum += r;
    env->episode_length_accum += 1;

    bool done = (env->timestep >= MAX_TIMESTEPS) || (env->health <= 0);
    if (in_bounds(env->player_r, env->player_c)
        && map_get(env, env->player_r, env->player_c) == BLK_LAVA) done = true;

    // Reference does: if (done) { terminals=1; add_log; puf_reset; } else compute_observations.
    // The driver stops here instead; observations are not parity state (PLAN 1.1).
    if (done) env->agents[0].terminals[0] = 1.0f;

    *out_reward = r;
    *out_done   = done;
}

// ============================================================
// Modes
// ============================================================
static int mode_layout(void) {
    printf("# canonical state layout, cc_ref_driver.c\n");
    printf("%-8s %-8s %-6s %-8s %s\n", "offset", "size", "type", "count", "field");
    int off = 0;
    for (int i = 0; i < CC_NUM_FIELDS; i++) {
        int sz = CC_T_SIZE[CC_FIELDS[i].type] * CC_FIELDS[i].count;
        printf("%-8d %-8d %-6s %-8d %s\n", off, sz, CC_T_NAME[CC_FIELDS[i].type],
               CC_FIELDS[i].count, CC_FIELDS[i].name);
        off += sz;
    }
    printf("total %d\n", off);
    return 0;
}

static int mode_rng(unsigned int seed, int n) {
    // Seed the stream exactly as c_init does, without building an Env.
    uint64_t s = (uint64_t)seed * 0x9E3779B97F4A7C15ULL + 0x87C37B91114253D5ULL;
    for (int i = 0; i < 8; i++) (void)cr_pcg(&s);
    for (int i = 0; i < n; i++) {
        // Each column re-runs the same single draw on a copy, so the line
        // describes one output rather than five consecutive ones.
        uint64_t sa = s;  uint32_t out = cr_pcg(&sa);
        uint64_t sb = s;  float f = cr_rf(&sb);
        uint64_t s4 = s;  int k4  = cr_ri(&s4, 4);
        uint64_t s8 = s;  int k8  = cr_ri(&s8, 8);
        uint64_t s64 = s; int k64 = cr_ri(&s64, 64);
        uint32_t fb; memcpy(&fb, &f, 4);
        printf("%u %08x %d %d %d\n", out, fb, k4, k8, k64);
        s = sa;  // one draw consumed per line
    }
    return 0;
}

static int mode_world(unsigned int seed) {
    CraftaxClassic* env = cc_new(seed);
    int nb = cc_state_bytes();
    unsigned char* buf = (unsigned char*)malloc(nb);
    cc_serialize(env, 0.0f, buf);
    fwrite(buf, 1, nb, stdout);
    free(buf);
    return 0;
}

static int mode_run(unsigned int seed, const char* actions_path, int dump_every) {
    FILE* af = fopen(actions_path, "rb");
    if (!af) { fprintf(stderr, "cc_ref: cannot open %s\n", actions_path); return 2; }
    fseek(af, 0, SEEK_END);
    long n_actions = ftell(af);
    fseek(af, 0, SEEK_SET);
    unsigned char* actions = (unsigned char*)malloc((size_t)n_actions);
    if (n_actions > 0 && fread(actions, 1, (size_t)n_actions, af) != (size_t)n_actions) {
        fprintf(stderr, "cc_ref: short read on %s\n", actions_path);
        return 2;
    }
    fclose(af);

    CraftaxClassic* env    = cc_new(seed);   // stepped by cc_step_no_reset
    CraftaxClassic* shadow = cc_new(seed);   // stepped by the real puf_step

    int nb = cc_state_bytes();
    unsigned char* buf  = (unsigned char*)malloc(nb);
    unsigned char* sbuf = (unsigned char*)malloc(nb);

    // The two envs must start identical; if they do not, nothing below means
    // anything.
    cc_serialize(env, 0.0f, buf);
    cc_serialize(shadow, 0.0f, sbuf);
    if (memcmp(buf, sbuf, nb) != 0) {
        fprintf(stderr, "cc_ref: seed %u: the two fresh envs differ\n", seed);
        return 3;
    }

    fwrite("CCR1", 1, 4, stdout);
    uint32_t hdr[2] = {(uint32_t)nb, (uint32_t)n_actions};
    fwrite(hdr, 4, 2, stdout);

    bool done = false;
    for (long t = 0; t < n_actions && !done; t++) {
        int a = actions[t];
        float reward = 0.0f;

        cc_step_no_reset(env, a, &reward, &done);
        cc_serialize(env, reward, buf);

        // Cross-check the transcription against the real puf_step.
        shadow->agents[0].actions[0] = (float)a;
        puf_step(shadow);
        float s_reward = shadow->agents[0].rewards[0];
        bool  s_done   = shadow->agents[0].terminals[0] != 0.0f;

        uint32_t rb, srb;
        memcpy(&rb, &reward, 4);
        memcpy(&srb, &s_reward, 4);
        if (rb != srb || s_done != done) {
            fprintf(stderr,
                "cc_ref: seed %u step %ld: transcription disagrees with puf_step "
                "(reward %08x vs %08x, done %d vs %d)\n",
                seed, t, rb, srb, (int)done, (int)s_done);
            return 3;
        }
        if (!done) {
            // Not terminal, so the shadow did not auto-reset: full state must match.
            cc_serialize(shadow, s_reward, sbuf);
            if (memcmp(buf, sbuf, nb) != 0) {
                int off = 0;
                while (off < nb && buf[off] == sbuf[off]) off++;
                fprintf(stderr,
                    "cc_ref: seed %u step %ld: transcription disagrees with puf_step "
                    "at canonical byte %d (%02x vs %02x)\n",
                    seed, t, off, buf[off], sbuf[off]);
                return 3;
            }
        }

        uint64_t h = fnv1a64(buf, nb);
        unsigned char has_dump = (unsigned char)(done || (dump_every > 0 && ((t + 1) % dump_every) == 0));
        fwrite(&h, 8, 1, stdout);
        fwrite(&rb, 4, 1, stdout);
        unsigned char d8 = (unsigned char)(done ? 1 : 0);
        fwrite(&d8, 1, 1, stdout);
        fwrite(&has_dump, 1, 1, stdout);
        if (has_dump) fwrite(buf, 1, nb, stdout);
    }
    // Not needed to free anything — puf_close is empty — but calling it is
    // what the reference's own API expects, and it keeps the function inside
    // the coverage the G3 gate measures.
    puf_close(env);
    puf_close(shadow);
    return 0;
}

static int mode_serve(unsigned int seed) {
    CraftaxClassic* env = cc_new(seed);
    int nb = cc_state_bytes();
    unsigned char* buf = (unsigned char*)malloc(nb);

    uint32_t nb32 = (uint32_t)nb;
    fwrite(&nb32, 4, 1, stdout);
    cc_serialize(env, 0.0f, buf);
    fwrite(buf, 1, nb, stdout);
    fflush(stdout);

    bool done = false;
    for (;;) {
        int c = fgetc(stdin);
        if (c == EOF) break;
        if (done) break;            // the episode is over; further actions are a caller bug
        float reward = 0.0f;
        cc_step_no_reset(env, c, &reward, &done);
        cc_serialize(env, reward, buf);
        unsigned char d8 = (unsigned char)(done ? 1 : 0);
        fwrite(&d8, 1, 1, stdout);
        fwrite(buf, 1, nb, stdout);
        fflush(stdout);
    }
    puf_close(env);
    free(buf);
    return 0;
}

// The player half of puf_step: lines 973-977 of craftax_classic.h, stopping
// before update_mobs. Same order, same effective-action rule.
static void cc_step_player_only(CraftaxClassic* env, int action) {
    if (action < 0) action = 0;
    if (action >= NUM_ACTIONS) action = NUM_ACTIONS - 1;
    int eff_action = env->is_sleeping ? ACT_NOOP : action;
    do_crafting(env, eff_action);
    if (eff_action == ACT_DO) do_action(env);
    if (eff_action >= ACT_PLACE_STONE && eff_action <= ACT_PLACE_PLANT) place_block(env, eff_action);
    move_player(env, eff_action);
}

static int mode_player(unsigned int seed, const char* actions_path) {
    FILE* af = fopen(actions_path, "rb");
    if (!af) { fprintf(stderr, "cc_ref: cannot open %s\n", actions_path); return 2; }
    fseek(af, 0, SEEK_END);
    long n_actions = ftell(af);
    fseek(af, 0, SEEK_SET);
    unsigned char* actions = (unsigned char*)malloc((size_t)n_actions);
    if (n_actions > 0 && fread(actions, 1, (size_t)n_actions, af) != (size_t)n_actions) {
        fprintf(stderr, "cc_ref: short read on %s\n", actions_path);
        return 2;
    }
    fclose(af);

    CraftaxClassic* env = cc_new(seed);
    int nb = cc_state_bytes();
    unsigned char* buf = (unsigned char*)malloc(nb);

    fwrite("CCR1", 1, 4, stdout);
    uint32_t hdr[2] = {(uint32_t)nb, (uint32_t)n_actions};
    fwrite(hdr, 4, 2, stdout);

    for (long t = 0; t < n_actions; t++) {
        cc_step_player_only(env, actions[t]);
        cc_serialize(env, 0.0f, buf);
        uint64_t h = fnv1a64(buf, nb);
        uint32_t rb = 0;
        unsigned char d8 = 0, has_dump = 1;
        fwrite(&h, 8, 1, stdout);
        fwrite(&rb, 4, 1, stdout);
        fwrite(&d8, 1, 1, stdout);
        fwrite(&has_dump, 1, 1, stdout);
        fwrite(buf, 1, nb, stdout);
    }
    puf_close(env);
    free(buf);
    free(actions);
    return 0;
}

static int usage(void) {
    fprintf(stderr,
        "usage: cc_ref layout\n"
        "       cc_ref rng   <seed> <n>\n"
        "       cc_ref world <seed>\n"
        "       cc_ref serve <seed>\n"
        "       cc_ref player <seed> <actions.bin>\n"
        "       cc_ref run   <seed> <actions.bin> [--dump-every K]\n");
    return 2;
}

int main(int argc, char** argv) {
    if (argc < 2) return usage();
    const char* mode = argv[1];
    if (strcmp(mode, "layout") == 0) return mode_layout();
    if (strcmp(mode, "rng") == 0) {
        if (argc != 4) return usage();
        return mode_rng((unsigned int)strtoul(argv[2], NULL, 10), atoi(argv[3]));
    }
    if (strcmp(mode, "world") == 0) {
        if (argc != 3) return usage();
        return mode_world((unsigned int)strtoul(argv[2], NULL, 10));
    }
    if (strcmp(mode, "serve") == 0) {
        if (argc != 3) return usage();
        return mode_serve((unsigned int)strtoul(argv[2], NULL, 10));
    }
    if (strcmp(mode, "player") == 0) {
        if (argc != 4) return usage();
        return mode_player((unsigned int)strtoul(argv[2], NULL, 10), argv[3]);
    }
    if (strcmp(mode, "run") == 0) {
        if (argc != 4 && argc != 6) return usage();
        int dump_every = 0;
        if (argc == 6) {
            if (strcmp(argv[4], "--dump-every") != 0) return usage();
            dump_every = atoi(argv[5]);
        }
        return mode_run((unsigned int)strtoul(argv[2], NULL, 10), argv[3], dump_every);
    }
    return usage();
}
