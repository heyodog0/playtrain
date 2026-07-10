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

void qjit_backedge(const void *b, int32_t off) {
  uint64_t i = mix(b, off) & (QJIT_CAP - 1);
  for (int probe = 0; probe < QJIT_CAP; probe++) {
    QEntry *e = &g_tab[(i + probe) & (QJIT_CAP - 1)];
    if (e->b == NULL) { e->b = b; e->off = off; e->count = 1; g_used++; return; }
    if (e->b == b && e->off == off) { e->count++; return; }
  }
  // table full: drop (stage-1 diagnostics only)
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
}
