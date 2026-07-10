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
static int32_t rec_anchor;
static struct { int32_t off; int op; } rec_trace[REC_MAX];
static int rec_len = 0;
static int rec_done = 0;      // stage 2 demo: record just the first hot loop
static const void *rec_hot_b; static int32_t rec_hot_anchor; static int rec_ready = 0;

void qjit_backedge(const void *b, int32_t off) {
  uint64_t i = mix(b, off) & (QJIT_CAP - 1);
  for (int probe = 0; probe < QJIT_CAP; probe++) {
    QEntry *e = &g_tab[(i + probe) & (QJIT_CAP - 1)];
    if (e->b == NULL) { e->b = b; e->off = off; e->count = 1; g_used++; return; }
    if (e->b == b && e->off == off) {
      e->count++;
      if (!rec_done && !qjit_rec_active && e->count == REC_THRESHOLD) {
        rec_b = b; rec_anchor = off; rec_len = 0; qjit_rec_active = 1;  // arm: record from the loop header
      }
      return;
    }
  }
}

void qjit_record(const void *b, int32_t off, int opcode) {
  if (b != rec_b) return;                 // stage 2: ignore ops in called JS funcs
  if (off == rec_anchor && rec_len > 0) { // completed one loop iteration
    qjit_rec_active = 0; rec_done = 1; rec_ready = 1; rec_hot_b = rec_b; rec_hot_anchor = rec_anchor;
    return;
  }
  if (rec_len < REC_MAX) { rec_trace[rec_len].off = off; rec_trace[rec_len].op = opcode; rec_len++; }
  else { qjit_rec_active = 0; rec_done = 1; }  // trace too long -> abort
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
