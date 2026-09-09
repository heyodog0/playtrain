// p5.cpp — state + implementation for the native p5 runtime. Mirrors
// runtime/p5/p5-shim.mjs call-for-call against the rasterizer C ABI.
#include "p5.hpp"
#include "raster_abi.h"

#include <vector>
#if defined(__x86_64__) || defined(_M_X64)
#include <immintrin.h>
#endif

namespace p5 {

struct StyleSnap {
  Color fill, stroke;
  bool strokeEnabled;
  bool fillEnabled;
  double strokeW;
  int rectMode, ellipseMode;
};

// ---- per-env shim state ----
// Formerly module-level singletons (one canvas per game, like the shim). Now
// bundled into a P5State so a multi-env host can give each env its own shim state
// and select the active one per worker thread. The field names below are redirected
// to the active state via the macros further down, so the rest of this file (the
// call-for-call shim port) is untouched and stays bit-exact. Single-threaded
// callers never select a state: the first access on a thread lazily creates one,
// reproducing the old single-global behavior exactly.
struct P5State {
  uint32_t _h = 0;
  int _width = 0, _height = 0;
  int _rasterRes = 0;   // device res; 0 => render at logical size
  int _frameCount = 0;
  double _devSx = 1.0, _devSy = 1.0;   // logical->device scale of the MAIN canvas (for image())
  std::vector<uint32_t> _targetStack;  // saved _h across setTarget/clearTarget

  Color _fill{255, 255, 255, 255};
  Color _stroke{0, 0, 0, 255};
  bool _strokeEnabled = true;
  bool _fillEnabled = true;
  double _strokeW = 1.0;
  int _rectMode = CORNER;
  int _ellipseMode = CENTER;

  // style cache (mirrors the shim's _ctxFill/_ctxStroke/_ctxLineW reparse guard;
  // sentinels = "unknown", exactly the shim's null mirrors)
  Color _ctxFill{-1, -1, -1, -1};
  Color _ctxStroke{-1, -1, -1, -1};
  double _ctxLineW = -1;

  std::vector<StyleSnap> _styleStack;
  std::vector<std::pair<double, double>> _shapeVerts;

  bool _keys[256] = {false};

  bool _webgl = false;   // createCanvas(w, h, WEBGL) — 3D calls forward to rs_3d_*
};

static thread_local P5State* _cur = nullptr;
static inline P5State& _S() {
  if (!_cur) _cur = new P5State();   // leaked per-thread default; matches old singleton
  return *_cur;
}

// Selectable per-env state API (used by native/qjs/qjs_vec_host.cpp). newState()
// creates a state without selecting it; selectState() makes it active for the
// calling thread; freeState() releases one that is not currently selected anywhere.
void* newState() { return (void*)new P5State(); }
void selectState(void* s) { _cur = (P5State*)s; }
void freeState(void* s) { delete (P5State*)s; }

// Redirect the shim's field identifiers to the active state. Declared AFTER the
// struct so its member declarations are unaffected; every function body below then
// transparently reads/writes the selected P5State.
#define _h            (_S()._h)
#define _width        (_S()._width)
#define _height       (_S()._height)
#define _rasterRes    (_S()._rasterRes)
#define _frameCount   (_S()._frameCount)
#define _devSx        (_S()._devSx)
#define _devSy        (_S()._devSy)
#define _targetStack  (_S()._targetStack)
#define _fill         (_S()._fill)
#define _stroke       (_S()._stroke)
#define _strokeEnabled (_S()._strokeEnabled)
#define _fillEnabled  (_S()._fillEnabled)
#define _strokeW      (_S()._strokeW)
#define _rectMode     (_S()._rectMode)
#define _ellipseMode  (_S()._ellipseMode)
#define _ctxFill      (_S()._ctxFill)
#define _ctxStroke    (_S()._ctxStroke)
#define _ctxLineW     (_S()._ctxLineW)
#define _styleStack   (_S()._styleStack)
#define _shapeVerts   (_S()._shapeVerts)
#define _keys         (_S()._keys)
#define _webgl        (_S()._webgl)

// ---- color pipeline (colorArgs + parseColor rounding) ----
static inline double clamp01(double x) { return js::min(1.0, js::max(0.0, x)); }

Color color(double gray) { double v = js::jround(gray); return {v, v, v, 255}; }
Color color(double gray, double alpha) {
  double v = js::jround(gray);
  return {v, v, v, js::jround(clamp01(alpha / 255.0) * 255.0)};
}
Color color(double r, double g, double b) {
  return {js::jround(r), js::jround(g), js::jround(b), 255};
}
Color color(double r, double g, double b, double a) {
  return {js::jround(r), js::jround(g), js::jround(b), js::jround(clamp01(a / 255.0) * 255.0)};
}

Color lerpColor(const Color& c1, const Color& c2, double amt) {
  // p5.js lerpColor(): componentwise, amt clamped to [0,1]. RGB rounded to
  // match the mjs shim's Math.round; alpha stays fractional (both pipelines
  // carry it unrounded until rasterization).
  double t = clamp01(amt);
  return {js::jround(c1.r + (c2.r - c1.r) * t),
          js::jround(c1.g + (c2.g - c1.g) * t),
          js::jround(c1.b + (c2.b - c1.b) * t),
          c1.a + (c2.a - c1.a) * t};
}

// ---- style application (defer until draw, mirroring _applyFill/_applyStroke) ----
static inline bool sameColor(const Color& a, const Color& b) {
  return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a;
}
static void applyFill() {
  if (!sameColor(_ctxFill, _fill)) {
    rs_set_fill(_h, _fill.r, _fill.g, _fill.b, _fill.a);
    _ctxFill = _fill;
  }
}
static void applyStroke() {
  if (!sameColor(_ctxStroke, _stroke)) {
    rs_set_stroke(_h, _stroke.r, _stroke.g, _stroke.b, _stroke.a);
    _ctxStroke = _stroke;
  }
  if (_ctxLineW != _strokeW) {
    rs_set_line_width(_h, _strokeW);
    _ctxLineW = _strokeW;
  }
}
// Match the shim's _invalidateStyleCache exactly: null every mirror so the
// next draw re-applies. A single validity flag is WRONG here — a fill-only
// draw after pop() must not resurrect stale stroke mirrors (the qbert
// terminal-frame divergence, 2026-09-01).
static void invalidateCache() {
  _ctxFill = Color{-1, -1, -1, -1};
  _ctxStroke = Color{-1, -1, -1, -1};
  _ctxLineW = -1;
}

// ---- lifecycle ----
void setRasterRes(int n) { if (n > 0) _rasterRes = n; }

void createCanvas(double w, double h) {
  _width = (int)w;
  _height = (int)h;
  int dw = _rasterRes > 0 ? _rasterRes : (int)w;
  int dh = _rasterRes > 0 ? _rasterRes : (int)h;
  _h = rs_new_canvas(w, h, (double)dw, (double)dh);
  _devSx = (double)dw / w;   // logical->device (for image() blit mapping)
  _devSy = (double)dh / h;
  _webgl = false;
}
void createCanvas(double w, double h, int mode) {
  createCanvas(w, h);
  if (mode == WEBGL) {
    _webgl = true;
    rs_3d_begin(_h, w, h);
    rs_3d_frame_begin();
  }
}
bool isWebgl() { return _webgl; }

// ---- offscreen graphics (createGraphics + image); see p5.hpp ----
int createGraphics(double w, double h) {
  // Allocate the layer at the MAIN canvas's device scale, not 1:1 logical.
  //
  // Previously this was rs_new_canvas(w, h, w, h): the layer rasterized at
  // logical res while the main canvas rasterizes directly at _rasterRes (obs
  // res, e.g. 64 for a 192 logical canvas => _devSx = 1/3). Shapes therefore
  // landed on a 3x finer grid inside the layer and image() nearest-neighbor
  // downsampled on blit, so a cached layer did NOT reproduce a direct draw —
  // sub-device-pixel features shifted (measured: 61 of 2048 obs px on a 1:1
  // no-scale blit; large rects matched, small shapes moved both directions).
  // That silently changed observations for any game using createGraphics, and
  // it blocked using a layer to cache static terrain.
  //
  // Matching the device scale makes shape rasterization use the same rounding
  // as a direct draw AND turns image() into a 1:1 device blit with no resample.
  // Round rather than truncate: _devSx is 64/192 = 0.3333..., so w * _devSx is
  // 63.999... and an int cast would allocate a 63px-wide layer.
  double dw = w * _devSx, dh = h * _devSy;
  return (int)rs_new_canvas(w, h, std::floor(dw + 0.5), std::floor(dh + 0.5));
}
void setTarget(int handle) {
  _targetStack.push_back(_h);
  _h = (uint32_t)handle;
  invalidateCache();  // rasterizer style state is per-canvas; force re-apply
}
void clearTarget() {
  if (!_targetStack.empty()) { _h = _targetStack.back(); _targetStack.pop_back(); }
  invalidateCache();
}
void image(int srcHandle, double x, double y, double w, double h) {
  // p5 image() honors the current transform; here we map logical->device via the
  // MAIN canvas base scale (image is only ever called at identity transform in
  // the layered variant). rs_draw_image nearest-neighbor resamples src -> dst rect.
  rs_draw_image(_h, (uint32_t)srcHandle, x * _devSx, y * _devSy, w * _devSx, h * _devSy);
}

#if defined(__x86_64__) || defined(_M_X64)
// RGBA->RGB pack, 8 pixels/iter: pshufb drops every 4th byte within each
// 128-bit lane (two 12-byte halves), a dword permute compacts them to 24
// contiguous bytes, stored as a 32-byte write whose top 8 bytes are
// overwritten by the next iteration. Pure byte reorder — bit-exact vs the
// scalar loop by construction. Returns pixels consumed; the last <=10 pixels
// are left for the scalar tail so the final 32-byte store stays inside
// out[0..3n).
__attribute__((target("avx2")))
static int blit_rgba_to_rgb_avx2(const uint8_t* px, uint8_t* out, int n) {
  const __m256i shuf = _mm256_setr_epi8(
      0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, -1, -1, -1, -1,
      0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, -1, -1, -1, -1);
  const __m256i perm = _mm256_setr_epi32(0, 1, 2, 4, 5, 6, 6, 6);
  int i = 0;
  for (; i + 11 <= n; i += 8) {
    __m256i v = _mm256_loadu_si256((const __m256i*)(px + i * 4));
    v = _mm256_shuffle_epi8(v, shuf);
    v = _mm256_permutevar8x32_epi32(v, perm);
    _mm256_storeu_si256((__m256i*)(out + i * 3), v);
  }
  return i;
}
#endif

void setDirty(bool on) { rs_set_dirty(on ? 1 : 0); }
void frameBegin() { if (_webgl) rs_3d_frame_begin(); rs_frame_begin(_h); }
int frameEnd() { int r = rs_frame_end(); if (_webgl) rs_3d_frame_end(); return r; }

int width() { return _width; }
int height() { return _height; }
int frameCount() { return _frameCount; }
void resetFrameCount() { _frameCount = 0; }
void tick() { _frameCount++; }

void render_obs_rgb(uint8_t* out) {
  // The JS obs path is rs_to_bgra (RGBA->BGRA premul) then bgraBufferToRGB
  // (BGRA->RGB), i.e. two passes. But the rasterizer forces every written pixel
  // to alpha=255 (span/plot/background all set a=255), so the final buffer is
  // fully opaque: premul is a no-op and BGRA->RGB round-trips to the original
  // RGB. We therefore read the internal RGBA buffer straight to RGB in ONE pass,
  // skipping rs_to_bgra. Byte-identical to V8 (proven by the differential gate).
  const uint8_t* px = rs_pixels_ptr(_h);  // RGBA straight-alpha, device res
  int n = _rasterRes > 0 ? _rasterRes * _rasterRes : _width * _height;
  int i = 0;
#if defined(__x86_64__) || defined(_M_X64)
  static const bool have_avx2 = __builtin_cpu_supports("avx2");
  if (have_avx2) i = blit_rgba_to_rgb_avx2(px, out, n);
#endif
  for (int s = i * 4, d = i * 3; i < n; i++, s += 4, d += 3) {
    out[d]     = px[s];      // R
    out[d + 1] = px[s + 1];  // G
    out[d + 2] = px[s + 2];  // B
  }
}

// ---- input ----
void setKeysDown(const int* codes, int n) {
  for (int i = 0; i < 256; i++) _keys[i] = false;
  for (int i = 0; i < n; i++) {
    int c = codes[i];
    if (c >= 0 && c < 256) _keys[c] = true;
  }
}
bool keyIsDown(int code) { return code >= 0 && code < 256 && _keys[code]; }

// ---- drawing state ----
void background(Color c) {
  rs_save(_h);
  rs_reset_transform(_h);
  rs_set_fill(_h, c.r, c.g, c.b, c.a);
  rs_fill_rect(_h, 0, 0, _width, _height);
  rs_restore(_h);
  invalidateCache();  // save/restore reset rasterizer state outside our cache
  if (_webgl) rs_3d_clear_depth();   // p5 WEBGL background() clears the depth buffer too
}
void background(double gray) { background(color(gray)); }
void background(double r, double g, double b) { background(color(r, g, b)); }

// In WEBGL mode fill() is the material's diffuse colour and is forwarded at
// once (no deferred applyFill: the 3D path has no rasterizer style cache).
void fill(Color c) { _fillEnabled = true; _fill = c; if (_webgl) rs_3d_fill(c.r, c.g, c.b); }
void fill(double gray) { fill(color(gray)); }
void fill(double gray, double a) { fill(color(gray, a)); }
void fill(double r, double g, double b) { fill(color(r, g, b)); }
void fill(double r, double g, double b, double a) { fill(color(r, g, b, a)); }

void stroke(Color c) { _strokeEnabled = true; _stroke = c; }
void stroke(double gray) { _strokeEnabled = true; _stroke = color(gray); }
void stroke(double r, double g, double b) { _strokeEnabled = true; _stroke = color(r, g, b); }
void stroke(double r, double g, double b, double a) { _strokeEnabled = true; _stroke = color(r, g, b, a); }
void noStroke() { _strokeEnabled = false; }
// Was a no-op, so every shape after noFill() came out filled in the native
// backend while the JS shim and the browser drew an outline. Two shipped games
// (vvvvvv.v2, jetpack_joyride.spaceship-viz-v2) failed native/gate_qjs.sh on it.
void noFill() { _fillEnabled = false; }
void strokeWeight(double w) { _strokeW = w; }
void rectMode(int mode) { _rectMode = (mode == CENTER) ? CENTER : CORNER; }
void ellipseMode(int mode) { _ellipseMode = (mode == CORNER) ? CORNER : CENTER; }

// ---- primitives ----
void rect(double x, double y, double w, double h) {
  double dx = x, dy = y;
  if (_rectMode == CENTER) { dx = x - w / 2; dy = y - h / 2; }
  if (_fillEnabled) { applyFill(); rs_fill_rect(_h, dx, dy, w, h); }
  if (_strokeEnabled) {
    applyStroke();
    rs_begin_path(_h);
    rs_rect_path(_h, dx, dy, w, h);
    rs_stroke(_h);
  }
}
void rect(double x, double y, double w, double h, double r) {
  if (!(r > 0)) { rect(x, y, w, h); return; }
  double dx = x, dy = y;
  if (_rectMode == CENTER) { dx = x - w / 2; dy = y - h / 2; }
  if (_fillEnabled) applyFill();
  rs_begin_path(_h);
  rs_round_rect_path(_h, dx, dy, w, h, r);
  if (_fillEnabled) rs_fill(_h);
  if (_strokeEnabled) { applyStroke(); rs_stroke(_h); }
}

void ellipse(double x, double y, double w, double h) {
  double cx = x, cy = y;
  if (_ellipseMode == CORNER) { cx = x + w / 2; cy = y + h / 2; }
  if (_fillEnabled) applyFill();
  rs_begin_path(_h);
  rs_ellipse_path(_h, cx, cy, w / 2, h / 2, 0, TWO_PI);
  if (_fillEnabled) rs_fill(_h);
  if (_strokeEnabled) { applyStroke(); rs_stroke(_h); }
}
void ellipse(double x, double y, double w) { ellipse(x, y, w, w); }

void arc(double x, double y, double w, double h, double start, double stop) {
  // p5.js arc(): sector fill + stroke via the rasterizer's angular ellipse
  // path (rs_ellipse_path has carried a0/a1 since day one).
  double cx = x, cy = y;
  if (_ellipseMode == CORNER) { cx = x + w / 2; cy = y + h / 2; }
  if (_fillEnabled) applyFill();
  rs_begin_path(_h);
  rs_ellipse_path(_h, cx, cy, w / 2, h / 2, start, stop);
  if (_fillEnabled) rs_fill(_h);
  if (_strokeEnabled) { applyStroke(); rs_stroke(_h); }
}
void circle(double x, double y, double d) { ellipse(x, y, d, d); }

void triangle(double x1, double y1, double x2, double y2, double x3, double y3) {
  if (_fillEnabled) applyFill();
  rs_begin_path(_h);
  rs_move_to(_h, x1, y1);
  rs_line_to(_h, x2, y2);
  rs_line_to(_h, x3, y3);
  rs_close_path(_h);
  if (_fillEnabled) rs_fill(_h);
  if (_strokeEnabled) { applyStroke(); rs_stroke(_h); }
}
void quad(double x1, double y1, double x2, double y2, double x3, double y3, double x4, double y4) {
  if (_fillEnabled) applyFill();
  rs_begin_path(_h);
  rs_move_to(_h, x1, y1);
  rs_line_to(_h, x2, y2);
  rs_line_to(_h, x3, y3);
  rs_line_to(_h, x4, y4);
  rs_close_path(_h);
  if (_fillEnabled) rs_fill(_h);
  if (_strokeEnabled) { applyStroke(); rs_stroke(_h); }
}
void line(double x1, double y1, double x2, double y2) {
  applyStroke();
  rs_begin_path(_h);
  rs_move_to(_h, x1, y1);
  rs_line_to(_h, x2, y2);
  rs_stroke(_h);
}

// ---- transform stack ----
void push() {
  if (_webgl) rs_3d_push(); else rs_save(_h);
  _styleStack.push_back({_fill, _stroke, _strokeEnabled, _fillEnabled, _strokeW, _rectMode, _ellipseMode});
}
void pop() {
  if (_webgl) rs_3d_pop(); else rs_restore(_h);
  if (!_styleStack.empty()) {
    StyleSnap s = _styleStack.back();
    _styleStack.pop_back();
    _fill = s.fill; _stroke = s.stroke; _strokeEnabled = s.strokeEnabled;
    _fillEnabled = s.fillEnabled;
    _strokeW = s.strokeW; _rectMode = s.rectMode; _ellipseMode = s.ellipseMode;
  }
  invalidateCache();
}
void translate(double x, double y) { if (_webgl) rs_3d_translate(x, y, 0); else rs_translate(_h, x, y); }
void rotate(double a) { if (_webgl) rs_3d_rotate_z(a); else rs_rotate(_h, a); }   // p5: rotate() == rotateZ() in WEBGL
void scale(double sx) { rs_scale(_h, sx, sx); }
void scale(double sx, double sy) { rs_scale(_h, sx, sy); }

// ---- WEBGL mode forwarders (see p5.hpp). In 2D mode they are no-ops, matching
// the rasterizer (rs_3d_* ignore a state with no 3D context). ----
void translate(double x, double y, double z) { if (_webgl) rs_3d_translate(x, y, z); else rs_translate(_h, x, y); }
void rotateX(double a) { rs_3d_rotate_x(a); }
void rotateY(double a) { rs_3d_rotate_y(a); }
void rotateZ(double a) { rs_3d_rotate_z(a); }
void ambientMaterial(Color c) { rs_3d_ambient_material(c.r, c.g, c.b); }
void specularMaterial(Color c) { rs_3d_specular_material(c.r, c.g, c.b); }
void shininess(double s) { rs_3d_shininess(s); }
void ambientLight(Color c) { rs_3d_ambient_light(c.r, c.g, c.b); }
void directionalLight(Color c, double x, double y, double z) { rs_3d_directional_light(c.r, c.g, c.b, x, y, z); }
void pointLight(Color c, double x, double y, double z) { rs_3d_point_light(c.r, c.g, c.b, x, y, z); }
void box(double w, double h, double d) { rs_3d_box(w, h, d); }
void box(double w, double h) { rs_3d_box(w, h, w); }
void box(double s) { rs_3d_box(s, s, s); }
void sphere(double r) { rs_3d_sphere(r); }
void ellipsoid(double rx, double ry, double rz) { rs_3d_ellipsoid(rx, ry, rz); }
void cylinder(double r, double h) { rs_3d_cylinder(r, h); }
void cone(double r, double h) { rs_3d_cone(r, h); }

// ---- shapes ----
void beginShape() { _shapeVerts.clear(); }
void vertex(double x, double y) { _shapeVerts.emplace_back(x, y); }
static void endShapeImpl(bool close) {
  if (_shapeVerts.size() < 2) return;
  if (_fillEnabled) applyFill();
  rs_begin_path(_h);
  rs_move_to(_h, _shapeVerts[0].first, _shapeVerts[0].second);
  for (size_t i = 1; i < _shapeVerts.size(); i++)
    rs_line_to(_h, _shapeVerts[i].first, _shapeVerts[i].second);
  if (close) rs_close_path(_h);
  if (_fillEnabled) rs_fill(_h);
  if (_strokeEnabled) { applyStroke(); rs_stroke(_h); }
}
void endShape() { endShapeImpl(false); }
void endShape(int mode) { endShapeImpl(mode == CLOSE); }

// ---- text (visual only; rasterizer has no text -> no-op, matches headless obs) ----
void textSize(double) {}
void textAlign(int) {}
void text(const std::string&, double, double) {}
void text(double, double, double) {}

}  // namespace p5
