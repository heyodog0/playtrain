// qjit.c — stage 1: hot-loop detection. Counts backward branches per
// (function, loop-header) and reports the hottest — the future trace anchors.
#include "qjit.h"
#include <stdio.h>
#include <stdlib.h>

#define QJIT_CAP 8192  // power of two
typedef struct { const void *b; int32_t off; uint64_t count; } QEntry;
static QEntry g_tab[QJIT_CAP];
static int g_used = 0;

static inline uint64_t mix(const void *b, int32_t off) {
  uint64_t h = (uint64_t)(uintptr_t)b * 1099511628211ull;
  h ^= (uint64_t)(uint32_t)off * 2654435761ull;
  return h ^ (h >> 29);
}

// --- stage 2: trace recording ---
#define REC_THRESHOLD 20000  // back-edges before we record this loop
#define REC_MAX 4096         // max bytecodes in a recorded trace
int qjit_rec_active = 0;
static const void *rec_b;
static int32_t rec_anchor, rec_source;
static struct { int32_t off; int op; } rec_trace[REC_MAX];
static int rec_len = 0;
static int rec_done = 0;      // stage 2 demo: record just the first hot loop
static const void *rec_hot_b; static int32_t rec_hot_anchor; static int rec_ready = 0;
static const void *cand_b = NULL; static int32_t cand_anchor;  // the chosen hot loop

void qjit_backedge(const void *b, int32_t source_off, int32_t target_off) {
  uint64_t i = mix(b, target_off) & (QJIT_CAP - 1);
  for (int probe = 0; probe < QJIT_CAP; probe++) {
    QEntry *e = &g_tab[(i + probe) & (QJIT_CAP - 1)];
    if (e->b == NULL) { e->b = b; e->off = target_off; e->count = 1; g_used++; break; }
    if (e->b == b && e->off == target_off) { e->count++; break; }
  }
  if (rec_done) return;
  // pick the first anchor to cross threshold as the recording candidate
  if (cand_b == NULL) {
    uint64_t j = mix(b, target_off) & (QJIT_CAP - 1);
    for (int probe = 0; probe < QJIT_CAP; probe++) {
      QEntry *e = &g_tab[(j + probe) & (QJIT_CAP - 1)];
      if (e->b == b && e->off == target_off) { if (e->count >= REC_THRESHOLD) { cand_b = b; cand_anchor = target_off; } break; }
      if (e->b == NULL) break;
    }
  }
  // (re-)arm recording on the candidate's back-edge (retries until a clean iteration)
  if (!qjit_rec_active && b == cand_b && target_off == cand_anchor) {
    rec_b = b; rec_anchor = target_off; rec_source = source_off; rec_len = 0; qjit_rec_active = 1;
  }
}

void qjit_record(const void *b, int32_t off, int opcode) {
  if (b != rec_b) { qjit_rec_active = 0; return; }            // left the function -> abort
  if (off < rec_anchor || off > rec_source) { qjit_rec_active = 0; return; }  // left loop body (exit/return/break) -> abort/retry
  if (off == rec_anchor && rec_len > 0) {                     // looped back to header -> success
    qjit_rec_active = 0; rec_done = 1; rec_ready = 1; rec_hot_b = rec_b; rec_hot_anchor = rec_anchor;
    return;
  }
  if (rec_len < REC_MAX) { rec_trace[rec_len].off = off; rec_trace[rec_len].op = opcode; rec_len++; }
  else { qjit_rec_active = 0; }  // too long -> abort/retry
}

// ---- stage 3: expose recorded trace + a small trace table ----
int qjit_rec_ready(void) { return rec_ready; }
const void *qjit_rec_b(void) { return rec_hot_b; }
int qjit_rec_anchor_off(void) { return rec_hot_anchor; }
int qjit_rec_count(void) { return rec_len; }
int qjit_rec_off(int i) { return (i >= 0 && i < rec_len) ? rec_trace[i].off : -1; }
int qjit_rec_opcode(int i) { return (i >= 0 && i < rec_len) ? rec_trace[i].op : -1; }
// allow the next hot loop to be recorded once this one is consumed
void qjit_rec_consume(void) { rec_ready = 0; rec_done = 0; cand_b = NULL; }

#define QJIT_MAX_TRACES 256
static QjitTrace g_traces[QJIT_MAX_TRACES];
static int g_n_traces = 0;
void qjit_store_trace(const QjitTrace *t) {
  if (g_n_traces < QJIT_MAX_TRACES) g_traces[g_n_traces++] = *t;
}
QjitTrace *qjit_lookup_trace(const void *b, int32_t anchor) {
  for (int i = 0; i < g_n_traces; i++)
    if (g_traces[i].b == b && g_traces[i].anchor == anchor) return &g_traces[i];
  return NULL;
}

static int cmp_desc(const void *a, const void *b) {
  uint64_t ca = ((const QEntry *)a)->count, cb = ((const QEntry *)b)->count;
  return ca < cb ? 1 : ca > cb ? -1 : 0;
}

void qjit_report(void *ctx) {
  QEntry *sorted = malloc(sizeof(QEntry) * g_used);
  int n = 0;
  for (int i = 0; i < QJIT_CAP; i++) if (g_tab[i].b) sorted[n++] = g_tab[i];
  qsort(sorted, n, sizeof(QEntry), cmp_desc);
  fprintf(stderr, "\n=== qjit hot loops (%d anchors, top 15 by back-edge count) ===\n", n);
  for (int i = 0; i < n && i < 15; i++) {
    const char *name = ctx ? qjit_fn_name(ctx, sorted[i].b) : "?";
    fprintf(stderr, "  %-24s pc=%-6d back-edges=%llu\n",
            name ? name : "<anon>", sorted[i].off, (unsigned long long)sorted[i].count);
  }
  free(sorted);

  if (rec_ready) {
    const char *fn = ctx ? qjit_fn_name(ctx, rec_hot_b) : "?";
    fprintf(stderr, "\n=== qjit recorded trace: %s @pc=%d, %d bytecodes ===\n",
            fn ? fn : "<anon>", rec_hot_anchor, rec_len);
    for (int i = 0; i < rec_len; i++)
      fprintf(stderr, "  %3d  pc=%-5d %s\n", i, rec_trace[i].off, qjit_opcode_name(rec_trace[i].op));
  }
}
