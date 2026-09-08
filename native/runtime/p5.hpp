// p5.hpp — native C++ reimplementation of the p5-shim API surface
// (runtime/p5/p5-shim.mjs), mapped onto the Rust rasterizer C ABI (raster_abi.h).
//
// This is the runtime library the AOT-compiled game twins call into. It mirrors
// the shim call-for-call so the rasterizer receives the identical primitive
// stream and produces byte-identical frames. Colors are rounded exactly as the
// shim's colorArgs()+parseColor() pipeline does (see p5.cpp).
#ifndef PLAYTRAIN_P5_HPP
#define PLAYTRAIN_P5_HPP

#include <cstdint>
#include <string>
#include "jsmath.h"

namespace p5 {

struct Color { double r, g, b, a; };  // pre-rounded channel bytes (0..255)

// Color constructors — match colorArgs()+parseColor() rounding.
Color color(double gray);
Color color(double gray, double alpha);
Color color(double r, double g, double b);
Color color(double r, double g, double b, double a);
Color lerpColor(const Color& c1, const Color& c2, double amt);

// Per-env shim state (for the multi-env threadpool host, qjs_vec_host.cpp).
// newState() allocates a fresh shim state without selecting it; selectState()
// makes it the active state for the calling thread; freeState() releases one.
// Single-env callers ignore this: a per-thread default state is created lazily.
void* newState();
void  selectState(void* s);
void  freeState(void* s);

// Canvas / frame lifecycle.
void createCanvas(double w, double h);   // rs_new_canvas at RASTER_RES device size
void createCanvas(double w, double h, int mode);   // mode == WEBGL flips the state into 3D
bool isWebgl();
void setRasterRes(int n);                 // must be called before createCanvas
int  width();
int  height();
int  frameCount();
void resetFrameCount();
void tick();                              // ++frameCount (draw() is called by the harness)

// Observation readback: writes obsW*obsH*3 RGB bytes (matches env fast path).
void render_obs_rgb(uint8_t* out);

// Dirty-rect whole-frame skip. setDirty(true) enables record/replay; frameBegin/frameEnd
// bracket the game's draw() (a no-op when dirty is off).
void setDirty(bool on);
void frameBegin();
int  frameEnd();   // returns 1 if the frame was skipped (dirty mode), else 0

// Input.
void setKeysDown(const int* codes, int n);
bool keyIsDown(int code);

// Drawing state.
void background(Color c);
void background(double gray);
void background(double r, double g, double b);
void fill(Color c);
void fill(double gray);
void fill(double gray, double a);
void fill(double r, double g, double b);
void fill(double r, double g, double b, double a);
void stroke(Color c);
void stroke(double gray);
void stroke(double r, double g, double b);
void stroke(double r, double g, double b, double a);
void noStroke();
void noFill();
void strokeWeight(double w);
void rectMode(int mode);
void ellipseMode(int mode);

// Primitives.
void rect(double x, double y, double w, double h);
void rect(double x, double y, double w, double h, double r);
void ellipse(double x, double y, double w, double h);
void ellipse(double x, double y, double w);  // h defaults to w
void arc(double x, double y, double w, double h, double start, double stop);
void circle(double x, double y, double d);
void triangle(double x1, double y1, double x2, double y2, double x3, double y3);
void quad(double x1, double y1, double x2, double y2, double x3, double y3, double x4, double y4);
void line(double x1, double y1, double x2, double y2);

// Transform stack.
void push();
void pop();
void translate(double x, double y);
void rotate(double a);
void scale(double sx);
void scale(double sx, double sy);

// ---- WEBGL mode (P5_WEBGL_PLAN.md; all math lives in the rasterizer, these
// are forwarders). Valid only after createCanvas(w, h, WEBGL); in 2D mode
// they are no-ops.
void translate(double x, double y, double z);
void rotateX(double a);
void rotateY(double a);
void rotateZ(double a);
void ambientMaterial(Color c);
void specularMaterial(Color c);
void shininess(double s);
void ambientLight(Color c);
void directionalLight(Color c, double x, double y, double z);
void pointLight(Color c, double x, double y, double z);
void box(double w, double h, double d);
void box(double w, double h);   // d defaults to w (p5)
void box(double s);
void sphere(double r);
void ellipsoid(double rx, double ry, double rz);
void cylinder(double r, double h);
void cone(double r, double h);

// Shapes.
void beginShape();
void vertex(double x, double y);
void endShape();       // open
void endShape(int mode);  // CLOSE

// Offscreen graphics (createGraphics + image) — retarget model. createGraphics
// allocates a second canvas rasterized 1:1 (device res == logical size).
// setTarget/clearTarget swap the shim's singleton draw target _h so the SAME
// global rect/fill/etc draw into the offscreen; image() blits an offscreen into
// the current target, logical coords mapped through the base device scale
// (nearest-neighbor downsample in rs_draw_image). NOTE: this is the "layer-cache"
// experiment path — pre-rasterize-then-
// rescale, which is NOT bit-exact to direct rendering on scaled-camera games.
int  createGraphics(double w, double h);
void setTarget(int handle);
void clearTarget();
void image(int srcHandle, double x, double y, double w, double h);

// Text — visual only, no rasterizer text; kept as no-ops that consume args so
// generated code compiles. (The shim renders text; the rasterizer's fillText is
// a no-op, so headless obs already omits text. Matches env behavior.)
void textSize(double s);
void textAlign(int align);
void text(const std::string& s, double x, double y);
void text(double s, double x, double y);

// Constants (p5 globals used by games).
constexpr int LEFT_ARROW = 37;
constexpr int UP_ARROW = 38;
constexpr int RIGHT_ARROW = 39;
constexpr int DOWN_ARROW = 40;
constexpr int ENTER = 13;
constexpr int CENTER = 1;   // rectMode/ellipseMode/textAlign selector
constexpr int CORNER = 2;
constexpr int LEFT = 3;
constexpr int RIGHT = 4;
constexpr int TOP = 5;
constexpr int BOTTOM = 6;
constexpr int BASELINE = 7;
constexpr int CLOSE = 1;    // endShape mode
constexpr int P2D = 1;      // createCanvas renderer selector
constexpr int WEBGL = 2;
constexpr double PI = 3.141592653589793;
constexpr double TWO_PI = 6.283185307179586;
constexpr double HALF_PI = 1.5707963267948966;

}  // namespace p5

#endif  // PLAYTRAIN_P5_HPP
