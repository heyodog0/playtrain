// playtrain-rasterizer — a tiny 2D rasterizer for the p5-shim primitive surface.
//
// Direct port of runtime/p5/raster.mjs (which is its spec + differential-test oracle).
// Compiles to wasm32-unknown-unknown with a raw extern "C" numeric API (no wasm-bindgen):
// all interop is scalar f64/u32 + reading output buffers from linear memory, so the JS glue
// (runtime/p5/raster-wasm.mjs) just calls exports and views WASM memory for the pixels.
//
// Design notes:
//   - The game draws in LOGICAL coordinates (e.g. 400); the base transform bakes a
//     logical->device scale so we rasterize directly at obs resolution (e.g. 64).
//   - Geometry in f64; pixels are RGBA u8 (straight alpha). toBuffer emits BGRA premultiplied
//     to match node-canvas' raw format, so the existing obs path is unchanged.
//   - Single-threaded (wasm): canvases live in a static registry, addressed by handle.

#![allow(static_mut_refs)]

// 3D pipeline for p5 WEBGL-mode games (rs_3d_* ABI). See three.rs.
pub mod three;
pub use three::*;

struct SubPath {
    pts: Vec<(f64, f64)>,
    closed: bool,
}

// Flattened fill edge (see fill_subpaths): endpoint coords plus the
// precomputed y-range (lo, hi) the crossing predicate tests.
struct Edge { ax: f64, ay: f64, bx: f64, by: f64, lo: f64, hi: f64 }

// One ellipse-offset cache way (see RState.ell_cache).
struct EllEntry { key: [u64; 4], offs: Vec<(f64, f64)>, full: bool }

const ELL_WAYS: usize = 64;

#[inline]
fn ell_slot(key: &[u64; 4]) -> usize {
    let mut h = 0xcbf29ce484222325u64;
    for &k in key {
        h = (h ^ k).wrapping_mul(0x100000001b3);
    }
    (h >> 32) as usize & (ELL_WAYS - 1)
}

// Match JS Uint8ClampedArray assignment exactly: clamp to [0,255], round-half-to-even.
// (Rust `as u8` truncates; JS rounds — that off-by-one was the only wasm!=js divergence,
// and it only showed on alpha-blended pixels.)
// Shared sin/cos for the rasterizer's own geometry — MUST be bit-identical to raster.mjs's
// _rsin/_rcos (same constants, same Horner order) so wasm==js regardless of angle. Replaces
// f64::sin/cos (libm), which differs from V8's fdlibm by ~1 ULP.
const TWO_PI: f64 = 6.283185307179586;
const PI_R: f64 = 3.141592653589793;
const PI_H: f64 = 1.5707963267948966;
#[inline]
fn psin(x: f64) -> f64 {
    let x = x - TWO_PI * ((x + PI_R) / TWO_PI).floor();
    let x2 = x * x;
    x * (1.0
        + x2 * (-0.16666666666666666
            + x2 * (0.008333333333333333
                + x2 * (-0.0001984126984126984 + x2 * 0.0000027557319223985893))))
}
#[inline]
fn pcos(x: f64) -> f64 {
    psin(x + PI_H)
}

#[inline]
pub(crate) fn clamp_u8(x: f64) -> u8 {
    if x <= 0.0 {
        return 0;
    }
    if x >= 255.0 {
        return 255;
    }
    let f = x.floor();
    let d = x - f;
    let r = if d < 0.5 {
        f
    } else if d > 0.5 {
        f + 1.0
    } else if (f as i64) & 1 == 0 {
        f
    } else {
        f + 1.0
    };
    r as u8
}

pub(crate) struct Canvas {
    pub(crate) dw: usize,
    pub(crate) dh: usize,
    sx: f64, // logical->device scale (base transform)
    sy: f64,
    pub(crate) px: Vec<u8>,   // RGBA straight-alpha, dw*dh*4
    out: Vec<u8>,  // BGRA premultiplied scratch for toBuffer
    t: [f64; 6],   // device = (a*x+c*y+e, b*x+d*y+f) = t[0..6]
    base: [f64; 6],
    stack: Vec<([f64; 6], [u8; 4], [u8; 4], f64)>,
    fill: [u8; 4],
    stroke: [u8; 4],
    line_w: f64,
    path: Vec<SubPath>,
    escratch: Vec<Edge>,   // reused per-fill flattened-edge buffer (fill_subpaths)
    xscratch: Vec<(f64, i32)>,   // reused per-scanline crossing buffer
}

// ---- per-env rasterizer state ----
// All mutable rasterizer state (the canvas registry + the dirty-rect frame globals)
// lives in one `RState`. A thread-local pointer selects the ACTIVE state, so a
// multi-env host (native/qjs/qjs_vec_host.cpp) can give each env its own state and
// swap between them on a worker thread with `rs_state_new` / `rs_state_select`.
// Single-threaded callers (trace/bench/serve) never touch that API: the first
// `rs()` on a thread lazily leaks one default RState, reproducing the old
// single-global behavior exactly (bit-exact, verified).
pub(crate) struct RState {
    canvases: Vec<Canvas>,
    // ---- dirty-rectangle: whole-frame skip via command record/replay ----
    // When `dirty` is on, a frame's draw ops are RECORDED (not executed) between
    // rs_frame_begin and rs_frame_end; if the command stream hashes identical to the
    // previous frame, the frame is SKIPPED (px still holds last frame's pixels ->
    // identical obs by determinism). Otherwise the buffer is replayed (ops execute)
    // and the hash cached. Opt-in via rs_set_dirty so the original direct path stays
    // available for the differential test (dirty off == on, per-frame).
    dirty: bool,
    recording: bool,
    rec: Vec<(u8, [f64; 6])>,
    last_hash: u64,
    has_last: bool,
    cur_h: u32,
    frame_opaque: bool,   // false if any a<255 fill/stroke this frame
    forceskip: bool,      // measurement: skip all render after frame 1
    // Memoized ellipse vertex offsets, keyed by (rx, ry, a0, a1) bit patterns.
    // Offsets depend only on those four params and games redraw the same
    // ellipse sizes every frame; values are the identical f64s the uncached
    // path computes, so output is bit-exact (see rs_ellipse_path).
    // Direct-mapped (64 ways, overwrite on collision): one multiply-mix + one
    // 32-byte key compare per lookup — a SipHash HashMap measured as much as
    // the ~17 Horner evals it was saving. APPENDED here (codegen hygiene:
    // round-4 A/B #8 regressed untouched span games when fields shifted).
    ell_cache: Vec<EllEntry>,
    // WEBGL-mode state (None for 2D games). APPENDED last, same codegen-
    // hygiene reason as ell_cache. Boxed so 2D RState layout barely moves.
    pub(crate) three: Option<Box<three::Three>>,
}

impl RState {
    fn new() -> RState {
        RState {
            canvases: Vec::new(),
            dirty: false,
            recording: false,
            rec: Vec::new(),
            last_hash: 0,
            has_last: false,
            cur_h: 0,
            frame_opaque: true,
            forceskip: false,
            ell_cache: Vec::new(),
            three: None,
        }
    }
}

use std::cell::Cell;
thread_local! {
    // Raw pointer to a leaked, `'static` RState. Leaking (never dropped) is
    // deliberate: worker threads live for the whole process and we want a stable
    // pointer we can hand back through the C ABI without lifetime gymnastics.
    static RS_CUR: Cell<*mut RState> = const { Cell::new(core::ptr::null_mut()) };
}

#[inline]
pub(crate) fn rs() -> &'static mut RState {
    RS_CUR.with(|p| {
        let mut ptr = p.get();
        if ptr.is_null() {
            ptr = Box::into_raw(Box::new(RState::new()));
            p.set(ptr);
        }
        unsafe { &mut *ptr }
    })
}

/// Allocate a fresh env state and return an opaque handle. Does NOT select it.
#[no_mangle]
pub extern "C" fn rs_state_new() -> *mut core::ffi::c_void {
    Box::into_raw(Box::new(RState::new())) as *mut core::ffi::c_void
}

/// Make `p` the active state for the calling thread. `p` must come from
/// `rs_state_new` (or be null to fall back to the thread's lazy default).
#[no_mangle]
pub extern "C" fn rs_state_select(p: *mut core::ffi::c_void) {
    RS_CUR.with(|c| c.set(p as *mut RState));
}

/// Free a state previously returned by `rs_state_new`. The caller must ensure it
/// is not the active state on any thread.
#[no_mangle]
pub extern "C" fn rs_state_free(p: *mut core::ffi::c_void) {
    if !p.is_null() {
        unsafe { drop(Box::from_raw(p as *mut RState)); }
    }
}

#[inline]
pub(crate) fn cv(h: u32) -> &'static mut Canvas {
    &mut rs().canvases[h as usize]
}

// record guard placed at the top of every draw op: returns true (op should return early) iff
// we're capturing this frame's commands.
#[inline]
fn rec(tag: u8, a: [f64; 6]) -> bool {
    let s = rs();
    if s.recording {
        // A semi-transparent fill/stroke makes re-rendering non-idempotent (double-blend),
        // so a frame containing one must NOT be whole-frame-skipped.
        if (tag == 7 || tag == 8) && a[3] < 255.0 {
            s.frame_opaque = false;
        }
        s.rec.push((tag, a));
        true
    } else {
        false
    }
}

#[no_mangle]
pub extern "C" fn rs_set_dirty(on: i32) {
    let s = rs();
    if s.three.is_some() { return; }   // 3D ops are not recorded; see rs_3d_begin
    s.dirty = on != 0;
    s.has_last = false;                                 // reset cache when toggled
    s.forceskip = std::env::var("RS_FORCESKIP").is_ok();
}

#[no_mangle]
pub extern "C" fn rs_frame_begin(h: u32) {
    let s = rs();
    if !s.dirty { return; }
    s.recording = true;
    s.rec.clear();
    s.cur_h = h;
    s.frame_opaque = true;
}

// returns 1 if the frame was identical to the previous (skipped), 0 if replayed/rendered.
#[no_mangle]
pub extern "C" fn rs_frame_end() -> i32 {
    // Phase 1: compute the command-stream hash under one short borrow (byte-identical
    // hash order to the pre-per-env-state version).
    let (hsh, cur_h) = {
        let s = rs();
        if !s.dirty { return 0; }
        s.recording = false;
        let mut hsh: u64 = 1469598103934665603;
        macro_rules! mix { ($v:expr) => {{ hsh ^= $v; hsh = hsh.wrapping_mul(1099511628211); }} }
        // Seed with the frame-START canvas state (recording didn't mutate it): identical
        // commands from different carried state (transform/fill/path/stack) must NOT be judged
        // identical, or a skip would reuse the wrong pixels (the qbert frame-118 bug).
        {
            let c = &s.canvases[s.cur_h as usize];
            for v in c.t.iter() { mix!(v.to_bits()); }
            for v in c.fill.iter() { mix!(*v as u64); }
            for v in c.stroke.iter() { mix!(*v as u64); }
            mix!(c.line_w.to_bits());
            for st in c.stack.iter() {
                for v in st.0.iter() { mix!(v.to_bits()); }
                for v in st.1.iter() { mix!(*v as u64); }
                for v in st.2.iter() { mix!(*v as u64); }
                mix!(st.3.to_bits());
            }
            mix!(0x5EED_5EED);
            for sp in c.path.iter() {
                for p in sp.pts.iter() { mix!(p.0.to_bits()); mix!(p.1.to_bits()); }
                mix!(0xF0F0_F0F0);
            }
            mix!(0xC0DE_C0DE);
        }
        for (t, a) in s.rec.iter() {
            mix!(*t as u64);
            for v in a.iter() { mix!(v.to_bits()); }
        }
        if s.has_last && hsh == s.last_hash && s.frame_opaque {
            return 1; // identical opaque frame -> re-render is idempotent -> px unchanged
        }
        // measurement hook: RS_FORCESKIP=1 skips ALL rendering after frame 1 (obs is bogus)
        // to isolate pure logic+record cost vs fill. Not a correctness path.
        if s.has_last && s.forceskip { s.last_hash = hsh; return 1; }
        (hsh, s.cur_h)
    };
    // Phase 2: replay the recorded commands. Each replayed op re-borrows rs()
    // internally (recording is now false, so rec() executes rather than captures),
    // so `rec` must be moved out first to avoid overlapping borrows.
    let cmds = core::mem::take(&mut rs().rec);
    for (t, a) in cmds.iter() {
        replay_one(cur_h, *t, a);
    }
    let s = rs();
    s.rec = cmds;
    s.last_hash = hsh;
    s.has_last = true;
    0
}

fn replay_one(h: u32, t: u8, a: &[f64; 6]) {
    match t {
        1 => rs_translate(h, a[0], a[1]),
        2 => rs_scale(h, a[0], a[1]),
        3 => rs_rotate(h, a[0]),
        4 => rs_save(h),
        5 => rs_restore(h),
        6 => rs_reset_transform(h),
        7 => rs_set_fill(h, a[0], a[1], a[2], a[3]),
        8 => rs_set_stroke(h, a[0], a[1], a[2], a[3]),
        9 => rs_set_line_width(h, a[0]),
        10 => rs_begin_path(h),
        11 => rs_move_to(h, a[0], a[1]),
        12 => rs_line_to(h, a[0], a[1]),
        13 => rs_close_path(h),
        14 => rs_rect_path(h, a[0], a[1], a[2], a[3]),
        15 => rs_round_rect_path(h, a[0], a[1], a[2], a[3], a[4]),
        16 => rs_ellipse_path(h, a[0], a[1], a[2], a[3], a[4], a[5]),
        17 => rs_fill(h),
        18 => rs_fill_rect(h, a[0], a[1], a[2], a[3]),
        19 => rs_stroke(h),
        _ => {}
    }
}

#[no_mangle]
pub extern "C" fn rs_new_canvas(lw: f64, lh: f64, dw: f64, dh: f64) -> u32 {
    let dwu = dw as usize;
    let dhu = dh as usize;
    let sx = dw / lw;
    let sy = dh / lh;
    let base = [sx, 0.0, 0.0, sy, 0.0, 0.0];
    let c = Canvas {
        dw: dwu,
        dh: dhu,
        sx,
        sy,
        px: vec![0u8; dwu * dhu * 4],
        out: vec![0u8; dwu * dhu * 4],
        t: base,
        base,
        stack: Vec::new(),
        fill: [0, 0, 0, 255],
        stroke: [0, 0, 0, 255],
        line_w: 1.0,
        path: Vec::new(),
        escratch: Vec::new(),
        xscratch: Vec::new(),
    };
    let s = rs();
    s.canvases.push(c);
    (s.canvases.len() - 1) as u32
}

#[no_mangle]
pub extern "C" fn rs_pixels_ptr(h: u32) -> *const u8 {
    cv(h).px.as_ptr()
}
#[no_mangle]
pub extern "C" fn rs_bgra_ptr(h: u32) -> *const u8 {
    cv(h).out.as_ptr()
}
#[no_mangle]
pub extern "C" fn rs_buf_len(h: u32) -> u32 {
    (cv(h).dw * cv(h).dh * 4) as u32
}

// ---- transform stack ----
#[no_mangle]
pub extern "C" fn rs_save(h: u32) {
    if rec(4, [0.0; 6]) { return; }
    let c = cv(h);
    c.stack.push((c.t, c.fill, c.stroke, c.line_w));
}
#[no_mangle]
pub extern "C" fn rs_restore(h: u32) {
    if rec(5, [0.0; 6]) { return; }
    let c = cv(h);
    if let Some((t, f, s, lw)) = c.stack.pop() {
        c.t = t;
        c.fill = f;
        c.stroke = s;
        c.line_w = lw;
    }
}
#[no_mangle]
pub extern "C" fn rs_reset_transform(h: u32) {
    if rec(6, [0.0; 6]) { return; }
    let c = cv(h);
    c.t = c.base;
}
#[no_mangle]
pub extern "C" fn rs_translate(h: u32, x: f64, y: f64) {
    if rec(1, [x, y, 0.0, 0.0, 0.0, 0.0]) { return; }
    let t = &mut cv(h).t;
    t[4] += t[0] * x + t[2] * y;
    t[5] += t[1] * x + t[3] * y;
}
#[no_mangle]
pub extern "C" fn rs_scale(h: u32, sx: f64, sy: f64) {
    if rec(2, [sx, sy, 0.0, 0.0, 0.0, 0.0]) { return; }
    let t = &mut cv(h).t;
    t[0] *= sx;
    t[1] *= sx;
    t[2] *= sy;
    t[3] *= sy;
}
#[no_mangle]
pub extern "C" fn rs_rotate(h: u32, a: f64) {
    if rec(3, [a, 0.0, 0.0, 0.0, 0.0, 0.0]) { return; }
    let t = &mut cv(h).t;
    let (s, co) = (psin(a), pcos(a));
    let (a0, b0, c0, d0) = (t[0], t[1], t[2], t[3]);
    t[0] = a0 * co + c0 * s;
    t[1] = b0 * co + d0 * s;
    t[2] = -a0 * s + c0 * co;
    t[3] = -b0 * s + d0 * co;
}

#[inline]
fn xf(t: &[f64; 6], x: f64, y: f64) -> (f64, f64) {
    (t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5])
}

// ---- style ----
#[no_mangle]
pub extern "C" fn rs_set_fill(h: u32, r: f64, g: f64, b: f64, a: f64) {
    if rec(7, [r, g, b, a, 0.0, 0.0]) { return; }
    cv(h).fill = [r as u8, g as u8, b as u8, a as u8];
}
#[no_mangle]
pub extern "C" fn rs_set_stroke(h: u32, r: f64, g: f64, b: f64, a: f64) {
    if rec(8, [r, g, b, a, 0.0, 0.0]) { return; }
    cv(h).stroke = [r as u8, g as u8, b as u8, a as u8];
}
#[no_mangle]
pub extern "C" fn rs_set_line_width(h: u32, w: f64) {
    if rec(9, [w, 0.0, 0.0, 0.0, 0.0, 0.0]) { return; }
    cv(h).line_w = w;
}

// ---- path building (points stored in DEVICE space) ----
#[no_mangle]
pub extern "C" fn rs_begin_path(h: u32) {
    if rec(10, [0.0; 6]) { return; }
    cv(h).path.clear();
}
#[no_mangle]
pub extern "C" fn rs_move_to(h: u32, x: f64, y: f64) {
    if rec(11, [x, y, 0.0, 0.0, 0.0, 0.0]) { return; }
    let c = cv(h);
    let p = xf(&c.t, x, y);
    c.path.push(SubPath { pts: vec![p], closed: false });
}
#[no_mangle]
pub extern "C" fn rs_line_to(h: u32, x: f64, y: f64) {
    if rec(12, [x, y, 0.0, 0.0, 0.0, 0.0]) { return; }
    let c = cv(h);
    let p = xf(&c.t, x, y);
    if let Some(sp) = c.path.last_mut() {
        sp.pts.push(p);
    } else {
        c.path.push(SubPath { pts: vec![p], closed: false });
    }
}
#[no_mangle]
pub extern "C" fn rs_close_path(h: u32) {
    if rec(13, [0.0; 6]) { return; }
    if let Some(sp) = cv(h).path.last_mut() {
        sp.closed = true;
    }
}
#[no_mangle]
pub extern "C" fn rs_rect_path(h: u32, x: f64, y: f64, w: f64, hh: f64) {
    if rec(14, [x, y, w, hh, 0.0, 0.0]) { return; }
    rs_move_to(h, x, y);
    rs_line_to(h, x + w, y);
    rs_line_to(h, x + w, y + hh);
    rs_line_to(h, x, y + hh);
    rs_close_path(h);
}
#[no_mangle]
pub extern "C" fn rs_round_rect_path(h: u32, x: f64, y: f64, w: f64, hh: f64, r0: f64) {
    if rec(15, [x, y, w, hh, r0, 0.0]) { return; }
    let r = r0.min(w / 2.0).min(hh / 2.0);
    let k = 6;
    let mut pts: Vec<(f64, f64)> = Vec::new();
    let mut corner = |cx: f64, cy: f64, a0: f64| {
        for i in 0..=k {
            let a = a0 + (core::f64::consts::PI / 2.0) * (i as f64 / k as f64);
            pts.push((cx + pcos(a) * r, cy + psin(a) * r));
        }
    };
    corner(x + w - r, y + r, -core::f64::consts::PI / 2.0);
    corner(x + w - r, y + hh - r, 0.0);
    corner(x + r, y + hh - r, core::f64::consts::PI / 2.0);
    corner(x + r, y + r, core::f64::consts::PI);
    rs_move_to(h, pts[0].0, pts[0].1);
    for p in pts.iter().skip(1) {
        rs_line_to(h, p.0, p.1);
    }
    rs_close_path(h);
}
#[no_mangle]
pub extern "C" fn rs_ellipse_path(h: u32, cx: f64, cy: f64, rx: f64, ry: f64, a0: f64, a1: f64) {
    if rec(16, [cx, cy, rx, ry, a0, a1]) { return; }
    // Memoize the vertex OFFSETS (pcos(a)*rx, psin(a)*ry): they depend only on
    // (rx, ry, a0, a1), and `cx + pcos(a) * rx` associates as cx + (pcos(a)*rx),
    // so adding (cx, cy) to a cached offset performs the identical f64 ops in
    // the identical order as the uncached loop — bit-exact by construction.
    let key = [rx.to_bits(), ry.to_bits(), a0.to_bits(), a1.to_bits()];
    let s = rs();
    if s.ell_cache.is_empty() {
        s.ell_cache.resize_with(ELL_WAYS, || EllEntry { key: [0; 4], offs: Vec::new(), full: false });
    }
    let slot = ell_slot(&key);
    let e = &mut s.ell_cache[slot];
    if !e.full || e.key != key {
        let span = a1 - a0;
        let n = (rx.max(ry) * 0.8).ceil().max(10.0) as i32;
        e.offs.clear();
        e.offs.reserve((n.max(0) + 1) as usize);
        for i in 0..=n {
            let a = a0 + span * (i as f64 / n as f64);
            e.offs.push((pcos(a) * rx, psin(a) * ry));
        }
        e.key = key;
        e.full = true;
    }
    // Raw-ptr snapshot: rs_move_to/rs_line_to re-enter rs() but never touch
    // ell_cache, so the Vec stays put for the duration of the loop.
    let offs: *const Vec<(f64, f64)> = &e.offs;
    let offs = unsafe { &*offs };
    for (i, &(ox, oy)) in offs.iter().enumerate() {
        let (ex, ey) = (cx + ox, cy + oy);
        if i == 0 {
            rs_move_to(h, ex, ey);
        } else {
            rs_line_to(h, ex, ey);
        }
    }
    rs_close_path(h);
}

// ---- fill ----
// inline(always): span is the rasterizer hot loop; leaving the decision to
// the inliner let sibling-function edits (round-4 pc lever) perturb its
// codegen inside rs_fill_rect and cost untouched games 2-8%.
#[inline(always)]
fn span(c: &mut Canvas, y: usize, xa: f64, xb: f64, col: [u8; 4]) {
    let w = c.dw;
    let x0 = (xa.round().max(0.0)) as usize;
    let x1 = (xb.round().min(w as f64)) as usize;
    if x1 <= x0 {
        return;
    }
    let [r, g, b, a] = col;
    let mut o = (y * w + x0) * 4;
    if a >= 255 {
        // opaque: one packed-RGBA u32 store per pixel (byte-identical to the 4 per-channel
        // stores; `o` is 4-aligned but use unaligned writes for portability). Removes the
        // per-byte bounds checks and lets the compiler vectorize the run — this span is the
        // rasterizer hot loop and ~96% of a render-bound frame.
        let packed = u32::from_ne_bytes([r, g, b, 255]);
        let n = x1 - x0;
        unsafe {
            let q = c.px.as_mut_ptr().add(o) as *mut u32;
            for i in 0..n {
                q.add(i).write_unaligned(packed);
            }
        }
    } else if a > 0 {
        let ia = a as f64 / 255.0;
        let na = 1.0 - ia;
        for _ in x0..x1 {
            c.px[o] = clamp_u8(r as f64 * ia + c.px[o] as f64 * na);
            c.px[o + 1] = clamp_u8(g as f64 * ia + c.px[o + 1] as f64 * na);
            c.px[o + 2] = clamp_u8(b as f64 * ia + c.px[o + 2] as f64 * na);
            c.px[o + 3] = 255;
            o += 4;
        }
    }
}

fn fill_subpaths(c: &mut Canvas, col: [u8; 4]) {
    // Borrow the path OUT of `c` (a pointer swap, no per-fill clone) so we can read its
    // points while span() takes &mut c.px. Restored before every return.
    let path = core::mem::take(&mut c.path);
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for sp in &path {
        for p in &sp.pts {
            if p.1 < min_y {
                min_y = p.1;
            }
            if p.1 > max_y {
                max_y = p.1;
            }
        }
    }
    if !min_y.is_finite() {
        c.path = path;
        return;
    }
    let y0 = min_y.floor().max(0.0) as usize;
    let y1 = (max_y.ceil().min((c.dh - 1) as f64)).max(0.0) as usize;
    // Flat edge prepass. The original per-scanline loop re-walked the subpath
    // structure and recomputed pts[(i+1)%n] for every edge on every scanline;
    // flatten the edges ONCE (into the canvas's persistent scratch — no per-
    // fill allocation) with (lo, hi) precomputed. Bit-exactness by
    // construction: an edge crosses iff lo <= sy < hi (the same predicate as
    // (ay<=sy&&by>sy)||(by<=sy&&ay>sy)), the crossing x uses the identical
    // expression, and the flat order IS the original iteration order, so xs
    // receives the same values in the same order (equal-x ties through the
    // stable sort keep the same winding sequence). At 64x64 device res shapes
    // span few scanlines, so anything cleverer (AET/sorting) measured SLOWER
    // than this — per-fill constants dominate.
    let mut edges = core::mem::take(&mut c.escratch);
    edges.clear();
    for sp in &path {
        let pts = &sp.pts;
        let n = pts.len();
        for i in 0..n {
            let a = pts[i];
            let b = pts[(i + 1) % n];
            let (lo, hi) = if a.1 <= b.1 { (a.1, b.1) } else { (b.1, a.1) };
            edges.push(Edge { ax: a.0, ay: a.1, bx: b.0, by: b.1, lo, hi });
        }
    }
    let mut xs = core::mem::take(&mut c.xscratch);
    for y in y0..=y1 {
        let sy = y as f64 + 0.5;
        xs.clear();
        for e in &edges {
            if e.lo <= sy && e.hi > sy {
                let x = e.ax + (sy - e.ay) / (e.by - e.ay) * (e.bx - e.ax);
                xs.push((x, if e.by > e.ay { 1 } else { -1 }));
            }
        }
        if xs.len() < 2 {
            continue;
        }
        xs.sort_by(|u, v| u.0.partial_cmp(&v.0).unwrap());
        let mut wind = 0;
        for i in 0..xs.len() - 1 {
            wind += xs[i].1;
            if wind != 0 {
                span(c, y, xs[i].0, xs[i + 1].0, col);
            }
        }
    }
    c.escratch = edges;   // hand the scratches back for the next fill
    c.xscratch = xs;
    c.path = path;   // restore (unchanged from entry) — matches the old clone-based behavior
}

#[no_mangle]
pub extern "C" fn rs_fill(h: u32) {
    if rec(17, [0.0; 6]) { return; }
    let c = cv(h);
    let col = c.fill;
    fill_subpaths(c, col);
}

#[no_mangle]
pub extern "C" fn rs_fill_rect(h: u32, x: f64, y: f64, w: f64, hh: f64) {
    if rec(18, [x, y, w, hh, 0.0, 0.0]) { return; }
    let c = cv(h);
    let col = c.fill;
    let t = c.t;
    if t[1] == 0.0 && t[2] == 0.0 {
        // axis-aligned fast path
        let mut x0 = t[0] * x + t[4];
        let mut y0 = t[3] * y + t[5];
        let mut x1 = t[0] * (x + w) + t[4];
        let mut y1 = t[3] * (y + hh) + t[5];
        if x1 < x0 {
            core::mem::swap(&mut x0, &mut x1);
        }
        if y1 < y0 {
            core::mem::swap(&mut y0, &mut y1);
        }
        let iy0 = y0.round().max(0.0) as usize;
        let iy1 = (y1.round().min(c.dh as f64)).max(0.0) as usize;
        for yy in iy0..iy1 {
            span(c, yy, x0, x1, col);
        }
    } else {
        c.path.clear();
        rs_rect_path(h, x, y, w, hh);
        let c2 = cv(h);
        fill_subpaths(c2, col);
    }
}

// ---- stroke (square brush along segments) ----
fn plot(c: &mut Canvas, cx: i64, cy: i64, rad: i64, col: [u8; 4]) {
    let (w, hh) = (c.dw as i64, c.dh as i64);
    let [r, g, b, a] = col;
    for oy in -rad..=rad {
        for ox in -rad..=rad {
            let (x, y) = (cx + ox, cy + oy);
            if x < 0 || y < 0 || x >= w || y >= hh {
                continue;
            }
            let o = ((y * w + x) * 4) as usize;
            if a >= 255 {
                let packed = u32::from_ne_bytes([r, g, b, 255]);   // one store vs 4 checked bytes
                unsafe { (c.px.as_mut_ptr().add(o) as *mut u32).write_unaligned(packed); }
            } else if a > 0 {
                let ia = a as f64 / 255.0;
                let na = 1.0 - ia;
                c.px[o] = clamp_u8(r as f64 * ia + c.px[o] as f64 * na);
                c.px[o + 1] = clamp_u8(g as f64 * ia + c.px[o + 1] as f64 * na);
                c.px[o + 2] = clamp_u8(b as f64 * ia + c.px[o + 2] as f64 * na);
                c.px[o + 3] = 255;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn rs_stroke(h: u32) {
    if rec(19, [0.0; 6]) { return; }
    let c = cv(h);
    let col = c.stroke;
    let lw = c.line_w.round().max(1.0);
    let rad = ((lw - 1.0) / 2.0) as i64;
    let path_edges: Vec<(Vec<(f64, f64)>, bool)> =
        c.path.iter().map(|sp| (sp.pts.clone(), sp.closed)).collect();
    for (pts, closed) in &path_edges {
        let n = pts.len();
        let last = if *closed { n } else { n.saturating_sub(1) };
        for i in 0..last {
            let a = pts[i];
            let b = pts[(i + 1) % n];
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let len = (dx * dx + dy * dy).sqrt().ceil().max(1.0) as i64;
            for j in 0..=len {
                let cx = (a.0 + dx * j as f64 / len as f64).round() as i64;
                let cy = (a.1 + dy * j as f64 / len as f64).round() as i64;
                plot(c, cx, cy, rad, col);
            }
        }
    }
}

// ---- nearest-neighbor blit / downsample between two canvases ----
#[no_mangle]
pub extern "C" fn rs_draw_image(dst_h: u32, src_h: u32, dx: f64, dy: f64, dw: f64, dh: f64) {
    let (sw, sh, spx) = {
        let s = cv(src_h);
        (s.dw, s.dh, s.px.clone())
    };
    let d = cv(dst_h);
    let (dxi, dyi) = (dx as i64, dy as i64);
    let (dwi, dhi) = (dw as usize, dh as usize);
    let w = d.dw;
    for y in 0..dhi {
        let syy = ((y * sh) / dhi).min(sh - 1);
        for x in 0..dwi {
            let sxx = ((x * sw) / dwi).min(sw - 1);
            let so = (syy * sw + sxx) * 4;
            let tx = dxi + x as i64;
            let ty = dyi + y as i64;
            if tx < 0 || ty < 0 || tx >= w as i64 || ty >= d.dh as i64 {
                continue;
            }
            let doff = ((ty as usize) * w + tx as usize) * 4;
            d.px[doff] = spx[so];
            d.px[doff + 1] = spx[so + 1];
            d.px[doff + 2] = spx[so + 2];
            d.px[doff + 3] = spx[so + 3];
        }
    }
}

// ---- BGRA premultiplied readback (matches node-canvas toBuffer('raw')) ----
#[no_mangle]
pub extern "C" fn rs_to_bgra(h: u32) {
    let c = cv(h);
    let n = c.dw * c.dh;
    for i in 0..n {
        let o = i * 4;
        let a = c.px[o + 3];
        if a >= 255 {
            c.out[o] = c.px[o + 2];
            c.out[o + 1] = c.px[o + 1];
            c.out[o + 2] = c.px[o];
            c.out[o + 3] = 255;
        } else {
            let m = a as f64 / 255.0;
            c.out[o] = (c.px[o + 2] as f64 * m) as u8;
            c.out[o + 1] = (c.px[o + 1] as f64 * m) as u8;
            c.out[o + 2] = (c.px[o] as f64 * m) as u8;
            c.out[o + 3] = a;
        }
    }
}
