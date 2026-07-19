// stub_raster.cpp — all rs_* as no-ops, for profiling. Links in place of the real
// rasterizer to measure the QuickJS->C boundary + p5-binding cost WITHOUT any fill
// work. Delta vs the real rasterizer = the rasterizer fill cost.
#include <cstdint>
static uint8_t stub_buf[64 * 64 * 4];
extern "C" {
uint32_t rs_new_canvas(double, double, double, double) { return 0; }
const uint8_t* rs_pixels_ptr(uint32_t) { return stub_buf; }
const uint8_t* rs_bgra_ptr(uint32_t) { return stub_buf; }
uint32_t rs_buf_len(uint32_t) { return sizeof(stub_buf); }
void rs_save(uint32_t) {}
void rs_restore(uint32_t) {}
void rs_reset_transform(uint32_t) {}
void rs_translate(uint32_t, double, double) {}
void rs_scale(uint32_t, double, double) {}
void rs_rotate(uint32_t, double) {}
void rs_set_fill(uint32_t, double, double, double, double) {}
void rs_set_stroke(uint32_t, double, double, double, double) {}
void rs_set_line_width(uint32_t, double) {}
void rs_begin_path(uint32_t) {}
void rs_move_to(uint32_t, double, double) {}
void rs_line_to(uint32_t, double, double) {}
void rs_close_path(uint32_t) {}
void rs_rect_path(uint32_t, double, double, double, double) {}
void rs_round_rect_path(uint32_t, double, double, double, double, double) {}
void rs_ellipse_path(uint32_t, double, double, double, double, double, double) {}
void rs_fill(uint32_t) {}
void rs_stroke(uint32_t) {}
void rs_fill_rect(uint32_t, double, double, double, double) {}
void rs_draw_image(uint32_t, uint32_t, double, double, double, double) {}
void rs_to_bgra(uint32_t) {}
}
