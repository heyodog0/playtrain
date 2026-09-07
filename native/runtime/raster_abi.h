// raster_abi.h — C declarations for the Rust rasterizer's extern "C" surface
// (crates/rasterizer/src/lib.rs). Built as libplaytrain_rasterizer.a and linked
// into the AOT-compiled native game twins. This is the SAME rasterizer the JS
// runtime uses via wasm (raster-wasm.mjs) — bit-identical output by construction.
#ifndef PLAYTRAIN_RASTER_ABI_H
#define PLAYTRAIN_RASTER_ABI_H

#include <cstdint>

extern "C" {

// Per-env rasterizer state (for the multi-env threadpool host, qjs_vec_host.cpp).
// rs_state_new() allocates a fresh state (canvas registry + dirty-rect globals)
// without selecting it; rs_state_select() makes it active for the calling thread;
// rs_state_free() releases one that is not selected anywhere. Single-env callers
// ignore these: a per-thread default state is created lazily on first use.
void* rs_state_new(void);
void  rs_state_select(void* p);
void  rs_state_free(void* p);

// Canvas lifecycle. Logical size (lw,lh) is the game's coordinate space;
// device size (dw,dh) is the rasterization resolution (obs res, e.g. 64).
uint32_t rs_new_canvas(double lw, double lh, double dw, double dh);

// Pixel buffers (straight-alpha RGBA and premultiplied BGRA scratch).
const uint8_t* rs_pixels_ptr(uint32_t h);
const uint8_t* rs_bgra_ptr(uint32_t h);
uint32_t       rs_buf_len(uint32_t h);

// Transform stack.
void rs_save(uint32_t h);
void rs_restore(uint32_t h);
void rs_reset_transform(uint32_t h);
void rs_translate(uint32_t h, double x, double y);
void rs_scale(uint32_t h, double sx, double sy);
void rs_rotate(uint32_t h, double a);

// Style.
void rs_set_fill(uint32_t h, double r, double g, double b, double a);
void rs_set_stroke(uint32_t h, double r, double g, double b, double a);
void rs_set_line_width(uint32_t h, double w);

// Path building (logical coords; transformed to device space internally).
void rs_begin_path(uint32_t h);
void rs_move_to(uint32_t h, double x, double y);
void rs_line_to(uint32_t h, double x, double y);
void rs_close_path(uint32_t h);
void rs_rect_path(uint32_t h, double x, double y, double w, double hh);
void rs_round_rect_path(uint32_t h, double x, double y, double w, double hh, double r0);
void rs_ellipse_path(uint32_t h, double cx, double cy, double rx, double ry,
                     double a0, double a1);

// Fill / stroke.
void rs_fill(uint32_t h);
void rs_stroke(uint32_t h);
void rs_fill_rect(uint32_t h, double x, double y, double w, double hh);

// Blit / downsample and readback.
void rs_draw_image(uint32_t dst_h, uint32_t src_h, double dx, double dy,
                   double dw, double dh);
void rs_to_bgra(uint32_t h);

// Dirty-rect whole-frame skip (record/replay). Between frame_begin/frame_end the draw ops
// are recorded; if the command stream matches the previous frame, rendering is skipped.
void rs_set_dirty(int on);
void rs_frame_begin(uint32_t h);
int  rs_frame_end(void);

// ---- 3D (p5 WEBGL mode; crates/rasterizer/src/three.rs) ----
// rs_3d_begin switches canvas h (logical lw x lh) into WEBGL mode on the active
// state: allocates the z-buffer + tessellation caches, disables dirty-rect
// record/replay. All later calls act on the active state's 3D context. Colours
// are pre-rounded 0..255 channel values (same pipeline as rs_set_fill).
void rs_3d_begin(uint32_t h, double lw, double lh);
void rs_3d_frame_begin(void);   // per draw(): reset model matrix + lights (p5 semantics)
void rs_3d_frame_end(void);     // reserved hook
void rs_3d_clear_depth(void);   // background() in WEBGL mode
void rs_3d_push(void);
void rs_3d_pop(void);
void rs_3d_translate(double x, double y, double z);
void rs_3d_rotate_x(double a);
void rs_3d_rotate_y(double a);
void rs_3d_rotate_z(double a);
void rs_3d_fill(double r, double g, double b);
void rs_3d_ambient_material(double r, double g, double b);
void rs_3d_specular_material(double r, double g, double b);
void rs_3d_shininess(double s);
void rs_3d_ambient_light(double r, double g, double b);
void rs_3d_directional_light(double r, double g, double b, double x, double y, double z);
void rs_3d_point_light(double r, double g, double b, double x, double y, double z);
void rs_3d_box(double w, double h, double d);
void rs_3d_sphere(double r);
void rs_3d_ellipsoid(double rx, double ry, double rz);
void rs_3d_cylinder(double r, double h);
void rs_3d_cone(double r, double h);
int  rs_3d_active(void);

}  // extern "C"

#endif  // PLAYTRAIN_RASTER_ABI_H
