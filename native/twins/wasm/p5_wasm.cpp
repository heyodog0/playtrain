// p5_wasm.cpp — the p5:: surface the twins draw through, as calls into the page's / game-env's p5 shim (the JS
// globals background, fill, noStroke, rect, drawTiles, createCanvas, keyIsDown). Same functions, same arguments as the
// JS preludes call, so the rasterizer receives the identical primitive stream. Anything else in p5.hpp is not used by
// a twin and aborts loudly if reached.
#include "p5.hpp"
#include <cstdlib>
#define PT_IMPORT(name) __attribute__((import_module("env"), import_name(#name)))
extern "C" {
PT_IMPORT(pt_createCanvas) void pt_createCanvas(double w, double h);
PT_IMPORT(pt_background1) void pt_background1(double gray);
PT_IMPORT(pt_background3) void pt_background3(double r, double g, double b);
PT_IMPORT(pt_fill1) void pt_fill1(double gray);
PT_IMPORT(pt_fill3) void pt_fill3(double r, double g, double b);
PT_IMPORT(pt_noStroke) void pt_noStroke();
PT_IMPORT(pt_rect) void pt_rect(double x, double y, double w, double h);
PT_IMPORT(pt_keyIsDown) int pt_keyIsDown(int code);
PT_IMPORT(pt_drawTiles) void pt_drawTiles(const uint16_t* kinds, int gw, int gh, const uint8_t* atlas, int tilePx, int nTiles, int x, int y, int w, int h);
PT_IMPORT(pt_abort) void pt_abort(const char* what);
}
namespace p5 {
void createCanvas(double w, double h) { pt_createCanvas(w, h); }
void createCanvas(double w, double h, int) { pt_createCanvas(w, h); }
void background(double gray) { pt_background1(gray); }
void background(double r, double g, double b) { pt_background3(r, g, b); }
void background(Color c) { pt_background3(c.r, c.g, c.b); }
void fill(double gray) { pt_fill1(gray); }
void fill(double r, double g, double b) { pt_fill3(r, g, b); }
void fill(Color c) { pt_fill3(c.r, c.g, c.b); }
void fill(double, double) { pt_abort("fill(gray, alpha)"); }
void fill(double, double, double, double) { pt_abort("fill(r, g, b, a)"); }
void noStroke() { pt_noStroke(); }
void rect(double x, double y, double w, double h) { pt_rect(x, y, w, h); }
void rect(double, double, double, double, double) { pt_abort("rect(x, y, w, h, r)"); }
bool keyIsDown(int code) { return pt_keyIsDown(code) != 0; }
void drawTiles(const uint16_t* kinds, int gw, int gh, const uint8_t* atlas, int tilePx, int nTiles, int dstX, int dstY, int dstW, int dstH) { pt_drawTiles(kinds, gw, gh, atlas, tilePx, nTiles, dstX, dstY, dstW, dstH); }
// host-only entry points a twin never calls
void* newState() { return nullptr; } void selectState(void*) {} void freeState(void*) {}
void setRasterRes(int) {} void setKeysDown(const int*, int) {}
}
