// stubs/ini.h — enough of PufferLib's ini.h to compile pufferenv.h.
//
// pufferenv.h includes "ini.h" for the Dict type its puf_init/puf_log take.
// The parity driver calls puf_init(env, NULL) and never calls puf_log, so a
// forward-declared opaque Dict and a no-op dict_set are all the reference
// needs. Nothing here affects stepped state.
#pragma once

typedef struct Dict Dict;

static inline void dict_set(Dict* d, const char* k, float v) { (void)d; (void)k; (void)v; }
