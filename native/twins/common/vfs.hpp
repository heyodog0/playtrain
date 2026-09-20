// vfs.hpp — the one file-reading primitive the twins use. Native builds read the disk; the wasm build (-DTWIN_WASM)
// reads a table of files embedded at build time (native/twins/wasm/build_game.mjs), so a .wasm game carries its
// sidecar, spec/state JSON and ROM inside itself and needs no filesystem.
#pragma once
#include <string>
namespace twin {
bool readFile(const std::string& path, std::string& out);   // false when absent
struct EmbeddedFile { const char* path; const unsigned char* data; unsigned long size; };
}
extern "C" { extern const twin::EmbeddedFile twin_embedded_files[]; extern const int twin_embedded_count; }   // the wasm build's table (build_game.mjs)
