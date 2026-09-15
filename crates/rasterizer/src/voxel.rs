// voxel.rs — the first-person voxel raycast primitive (FIRST_PERSON_PLAN.md §4.2).
//
// One Amanatides-Woo DDA ray per pixel through a 2D grid of unit blocks,
// textured from a flat tile atlas. This is the whole of craftax_fp's world
// render: no triangles, no camera matrix, no z-buffer resolve, no meshing.
// three.rs stays the pipeline for p5 WEBGL games; this is a separate, much
// smaller thing that exists because a voxel world does not need any of that.
//
// GEOMETRY (plan §4.1). Grid cell (r, c) is the unit square x∈[c,c+1),
// z∈[r,r+1); y is up. Every cell has a FLOOR at y=0 textured with the cell's
// tile. A cell whose low bit is set is additionally a full CUBE y∈[0,1),
// textured with the same tile on all four sides and the top (Craftax has no
// side-face art, so one texture per block is all there is).
//
// DETERMINISM (plan §6, and the reason this file exists at all). f32
// throughout; only + - * / sqrt and compares; no libm (no sin/cos/pow/floor
// — `ffloor` below is a cast and a compare); no mul_add, and Rust does not
// contract on its own. Every constant is a literal. The per-call path does
// not allocate: the depth buffer is sized once per canvas and the staging
// buffers once per grid/atlas size. Native and wasm32 must therefore produce
// byte-identical pixels, which `tests/wasm_voxel_check.mjs` asserts against
// the golden hashes the unit tests below emit.
//
// YAW is a quarter turn, 0..3, applied as exact swaps and negations — no trig
// at all. That is deliberate (plan §4.2): Craftax's movement is absolute and
// discrete, so the camera only ever faces one of four directions, and a free
// yaw would need three.rs's `ksin`/`kcos` instead.
//
// SKY. Rays that leave the grid, pass beyond `view_dist`, or rise above the
// block tops with nothing in the way get `sky_rgb`. Craftax's asset set has
// no sky texture and no palette entry for one — the top-down view never shows
// sky — so the colour is a parameter rather than a constant baked in here,
// and the game picks it. The goldens below use 0x87CEEB.
//
// POINTERS AND WASM. The plan's signature takes `*const u16` / `*const u8`.
// Native hosts pass their own buffers straight in. JS cannot make a pointer
// into wasm linear memory on its own, so `rs_voxel_grid_ptr` /
// `rs_voxel_atlas_ptr` hand out pointers to rasterizer-owned staging buffers
// that JS writes through, exactly as `raster-wasm.mjs` already writes pixels
// through `rs_pixels_ptr`. The staging buffers live in the per-env RState, not
// in a global, so a multi-env host (qjs_vec_host) keeps one grid per env.

use crate::{cv, pcos, psin, rs};

/// Per-env staging for the grid and atlas the JS side writes through.
pub(crate) struct Voxel {
    grid: Vec<u16>,
    atlas: Vec<u8>,
    noise: Vec<f32>,
}

#[inline]
fn vx() -> &'static mut Voxel {
    let s = rs();
    if s.voxel.is_none() {
        s.voxel = Some(Box::new(Voxel {
            grid: Vec::new(),
            atlas: Vec::new(),
            noise: Vec::new(),
        }));
    }
    s.voxel.as_mut().unwrap()
}

/// Pointer to a grid staging buffer of at least `cells` u16s. Grows only when
/// the request grows, so the steady state allocates nothing.
#[no_mangle]
pub extern "C" fn rs_voxel_grid_ptr(cells: u32) -> *mut u16 {
    let v = vx();
    if v.grid.len() < cells as usize {
        v.grid.resize(cells as usize, 0);
    }
    v.grid.as_mut_ptr()
}

/// Pointer to an atlas staging buffer of at least `bytes` bytes (RGBA).
#[no_mangle]
pub extern "C" fn rs_voxel_atlas_ptr(bytes: u32) -> *mut u8 {
    let v = vx();
    if v.atlas.len() < bytes as usize {
        v.atlas.resize(bytes as usize, 0);
    }
    v.atlas.as_mut_ptr()
}

// floor(x) as i32, without libm: `as i32` truncates toward zero, so one
// compare fixes the negative case. Exact for every finite f32 in range.
#[inline]
fn ffloor(x: f32) -> i32 {
    let t = x as i32;
    if (t as f32) > x { t - 1 } else { t }
}

#[inline]
fn frac(x: f32) -> f32 {
    x - (ffloor(x) as f32)
}

// Stands in for +inf so that a zero direction component can never produce
// inf * 0 = NaN in the DDA. Larger than any t a 64-cell grid can reach.
const BIG: f32 = 1.0e30;

// ---- look ----------------------------------------------------------------
// Three constants that exist purely so the frame is legible. They are
// literals rather than parameters on purpose: the ABI is already 17 arguments
// and none of these is something a game would want to vary.
//
// FACE SHADING. Craftax has no side-face art, so a cube is the same texture on
// all five visible faces — and with no shading, two faces of one block meeting
// at an edge are indistinguishable. A stone wall reads as a field of noise
// rather than as blocks. Multiplying by a per-face constant is the standard
// voxel fix and costs one multiply per pixel; the DDA already knows which face
// it struck. Top surfaces (block tops and floors) stay at full brightness,
// which also keeps the floor exactly as the top-down view shows it.
const SHADE_X: f32 = 0.62; // faces whose normal is +/-x
const SHADE_Z: f32 = 0.80; // faces whose normal is +/-z
const SHADE_TOP: f32 = 1.0; // block tops and floors

// DISTANCE FOG. Without it the world ends in a hard circle at view_dist, which
// reads as a bug. Fog starts partway out and reaches full strength exactly at
// view_dist, so the cutoff becomes the end of a gradient instead of an edge.
const FOG_START_FRAC: f32 = 0.55;

// SKY GRADIENT. A flat fill gives the frame no up. The zenith is the sky
// colour scaled down; the horizon is the sky colour itself.
const SKY_ZENITH_SCALE: f32 = 0.66;

/// Render a first-person view of `grid` into the rect (`dst_x`, `dst_y`,
/// `dst_w`, `dst_h`) of canvas `canvas`, and fill that rect of the canvas's
/// depth buffer for `rs_voxel_sprite` to test against.
///
/// The depth written is the hit's **forward** distance — its camera-space z,
/// not the Euclidean distance along the ray. Those differ by the ray's length
/// (up to sqrt(3) at a frame corner, with a 90 degree FOV both ways), and a
/// billboard's depth is naturally a forward distance, so storing Euclidean
/// here would let a sprite draw through a wall near the edges of the frame:
/// the wall's stored Euclidean depth can exceed the sprite's forward depth
/// even when the wall is genuinely in front. Sky is +inf.
///
/// `view_dist` is still Euclidean, so the draw distance stays a circle rather
/// than becoming a slab.
///
/// `grid` is row-major `gh` rows of `gw` cells, each cell packed as
/// `(atlas_tile << 1) | solid`. `atlas` is `n_tiles` tiles of
/// `tile_px`×`tile_px` RGBA, tile-major then row-major (the same layout
/// `80_render.js` indexes with `spriteIdx * ATLAS_STRIDE`). `sky_rgb` is
/// 0xRRGGBB. FOV is 90° horizontal and vertical: `tan(45°)` is exactly 1, so
/// the ray direction needs no trig and no magic constant.
#[no_mangle]
pub extern "C" fn rs_voxel_view(
    canvas: u32,
    grid: *const u16,
    gw: u32,
    gh: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw_q: u32,
    view_dist: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    sky_rgb: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    let (fx, fz, rx, rz) = quarter_basis(yaw_q);
    view_with_basis(
        canvas, grid, gw, gh, eye_x, eye_y, eye_z, fx, fz, rx, rz, view_dist,
        atlas, tile_px, n_tiles, sky_rgb, dst_x, dst_y, dst_w, dst_h,
    )
}

/// The same view, with a FREE yaw in radians instead of a quarter turn.
///
/// Display only. The training observation goes through `rs_voxel_view`, whose
/// quarter-turn basis is exact swaps and whose goldens are pinned; this exists
/// so a human-facing page can animate the camera smoothly between the four
/// facings the game actually has. Trig is the rasterizer's own `psin`/`pcos`,
/// which `runtime/p5/raster.mjs` mirrors exactly as `_rsin`/`_rcos`, so the
/// wasm and pure-JS backends still agree with each other.
///
/// Yaw 0 faces -z and increases toward +x, matching `quarter_basis`.
#[no_mangle]
pub extern "C" fn rs_voxel_view_free(
    canvas: u32,
    grid: *const u16,
    gw: u32,
    gh: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw: f32,
    view_dist: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    sky_rgb: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    let (fx, fz, rx, rz) = free_basis(yaw);
    view_with_basis(
        canvas, grid, gw, gh, eye_x, eye_y, eye_z, fx, fz, rx, rz, view_dist,
        atlas, tile_px, n_tiles, sky_rgb, dst_x, dst_y, dst_w, dst_h,
    )
}

/// Camera basis (forward_x, forward_z, right_x, right_z) for a quarter turn.
/// q0 faces -z (row decreasing), q1 +x, q2 +z, q3 -x.
#[inline]
fn quarter_basis(yaw_q: u32) -> (f32, f32, f32, f32) {
    match yaw_q & 3 {
        0 => (0.0, -1.0, 1.0, 0.0),
        1 => (1.0, 0.0, 0.0, 1.0),
        2 => (0.0, 1.0, -1.0, 0.0),
        _ => (-1.0, 0.0, 0.0, -1.0),
    }
}

/// The same basis for an arbitrary yaw. At exact multiples of pi/2 this is not
/// bit-identical to `quarter_basis` (psin(pi/2) is not exactly 1), which is
/// why the two are separate entry points rather than one.
#[inline]
fn free_basis(yaw: f32) -> (f32, f32, f32, f32) {
    let s = psin(yaw as f64) as f32;
    let c = pcos(yaw as f64) as f32;
    // forward = (sin, -cos): yaw 0 -> (0, -1), yaw pi/2 -> (1, 0).
    (s, -c, c, s)
}

#[allow(clippy::too_many_arguments)]
fn view_with_basis(
    canvas: u32,
    grid: *const u16,
    gw: u32,
    gh: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    fwd_x: f32,
    fwd_z: f32,
    rgt_x: f32,
    rgt_z: f32,
    view_dist: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    sky_rgb: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if grid.is_null() || atlas.is_null() {
        return;
    }
    if gw == 0 || gh == 0 || dst_w == 0 || dst_h == 0 || tile_px == 0 || n_tiles == 0 {
        return;
    }

    let c = cv(canvas);
    let cw = c.dw;
    let ch = c.dh;
    if cw == 0 || ch == 0 {
        return;
    }
    if c.depth.len() != cw * ch {
        c.depth = vec![f32::INFINITY; cw * ch];
    }

    let sky_r = ((sky_rgb >> 16) & 255) as u8;
    let sky_g = ((sky_rgb >> 8) & 255) as u8;
    let sky_b = (sky_rgb & 255) as u8;

    let gwi = gw as i32;
    let ghi = gh as i32;
    let gwu = gw as usize;
    let tpx = tile_px as f32;
    let tmax = tile_px as i32 - 1;
    let tstride = (tile_px as usize) * (tile_px as usize) * 4;
    let fw = dst_w as f32;
    let fh = dst_h as f32;

    for py in 0..dst_h {
        let cyp = dst_y + py;
        if cyp as usize >= ch {
            continue;
        }
        // Screen y runs down; camera y runs up. tan(vfov/2) == 1.
        let sy = 1.0f32 - 2.0f32 * ((py as f32 + 0.5f32) / fh);

        for px in 0..dst_w {
            let cxp = dst_x + px;
            if cxp as usize >= cw {
                continue;
            }
            let sx = 2.0f32 * ((px as f32 + 0.5f32) / fw) - 1.0f32;

            // The ray in world terms: screen-x along the camera's right
            // vector, plus one unit forward. With the quarter-turn basis the
            // components are 0 and +/-1, so each product is exact and this is
            // the same arithmetic as writing the four cases out by hand.
            let rdx = sx * rgt_x + fwd_x;
            let rdz = sx * rgt_z + fwd_z;
            let rdy = sy;

            // Normalise so t is a Euclidean distance: `view_dist` then means
            // blocks in every direction, and the depth buffer a sprite pass
            // can compare against is in the same units.
            let len = (rdx * rdx + rdy * rdy + rdz * rdz).sqrt();
            let dx = rdx / len;
            let dy = rdy / len;
            let dz = rdz / len;

            // --- DDA setup (Amanatides-Woo) ---
            let mut mx = ffloor(eye_x);
            let mut mz = ffloor(eye_z);

            let adx = if dx < 0.0f32 { -dx } else { dx };
            let adz = if dz < 0.0f32 { -dz } else { dz };
            let ddx = if adx > 0.0f32 { 1.0f32 / adx } else { BIG };
            let ddz = if adz > 0.0f32 { 1.0f32 / adz } else { BIG };
            let stepx: i32 = if dx > 0.0f32 { 1 } else { -1 };
            let stepz: i32 = if dz > 0.0f32 { 1 } else { -1 };
            let mut sidex = if adx > 0.0f32 {
                if dx > 0.0f32 {
                    ((mx + 1) as f32 - eye_x) * ddx
                } else {
                    (eye_x - mx as f32) * ddx
                }
            } else {
                BIG
            };
            let mut sidez = if adz > 0.0f32 {
                if dz > 0.0f32 {
                    ((mz + 1) as f32 - eye_z) * ddz
                } else {
                    (eye_z - mz as f32) * ddz
                }
            } else {
                BIG
            };

            // --- the y slab ---
            // Blocks occupy y∈[0,1). A side face can only be struck while the
            // ray is inside that slab; the floor plane y=0 and the top plane
            // y=1 are crossed at most once each, and only on a descending ray.
            let mut t_in = 0.0f32;
            let mut t_out = BIG;
            let mut t_floor = BIG;
            let mut t_top = BIG;
            if dy < 0.0f32 {
                let t0 = (0.0f32 - eye_y) / dy;
                let t1 = (1.0f32 - eye_y) / dy;
                if t1 > 0.0f32 {
                    t_in = t1;
                    t_top = t1;
                }
                if t0 > 0.0f32 {
                    t_out = t0;
                    t_floor = t0;
                } else {
                    t_out = 0.0f32;
                }
            } else if dy > 0.0f32 {
                let t0 = (0.0f32 - eye_y) / dy;
                let t1 = (1.0f32 - eye_y) / dy;
                if t0 > 0.0f32 {
                    t_in = t0;
                }
                if t1 > 0.0f32 {
                    t_out = t1;
                } else {
                    t_out = 0.0f32;
                }
            } else if eye_y < 0.0f32 || eye_y >= 1.0f32 {
                t_out = 0.0f32;
            }

            // --- march ---
            // hit: 0 sky, 1 side on x, 2 side on z, 3 top, 4 floor
            let mut hit = 0u8;
            let mut t_hit = 0.0f32;
            let mut tile = 0u32;
            let mut t_enter = 0.0f32;
            let mut axis_x = true;
            let mut first = true;

            loop {
                if mx < 0 || mz < 0 || mx >= gwi || mz >= ghi {
                    break;
                }
                if t_enter > view_dist {
                    break;
                }
                let cell = unsafe { *grid.add((mz as usize) * gwu + (mx as usize)) };
                let solid = (cell & 1) != 0;
                let ctile = (cell >> 1) as u32;
                let t_exit = if sidex < sidez { sidex } else { sidez };

                // 1. a side face, struck on entry to this cell
                if !first && solid && t_enter >= t_in && t_enter < t_out {
                    hit = if axis_x { 1 } else { 2 };
                    t_hit = t_enter;
                    tile = ctile;
                    break;
                }
                // 2. this cell's top face, if the ray descends through y=1 inside it
                if solid && t_top >= t_enter && t_top < t_exit {
                    hit = 3;
                    t_hit = t_top;
                    tile = ctile;
                    break;
                }
                // 3. the floor of this cell (every cell has one)
                if t_floor >= t_enter && t_floor < t_exit {
                    hit = 4;
                    t_hit = t_floor;
                    tile = ctile;
                    break;
                }

                if sidex < sidez {
                    t_enter = sidex;
                    sidex += ddx;
                    mx += stepx;
                    axis_x = true;
                } else {
                    t_enter = sidez;
                    sidez += ddz;
                    mz += stepz;
                    axis_x = false;
                }
                first = false;
            }

            if hit != 0 && t_hit > view_dist {
                hit = 0;
            }

            let (r, g, b, depth) = if hit == 0 {
                // Vertical gradient: SKY_ZENITH_SCALE of the sky colour at the
                // top of the view, the sky colour itself at the horizon (the
                // middle row). Below the horizon a ray only reaches here if it
                // left the grid, and those pixels take the horizon colour.
                let half = fh * 0.5f32;
                let mut k = (half - py as f32) / half;
                if k < 0.0f32 { k = 0.0f32; }
                if k > 1.0f32 { k = 1.0f32; }
                let m = 1.0f32 - k * (1.0f32 - SKY_ZENITH_SCALE);
                (
                    ((sky_r as f32) * m) as u8,
                    ((sky_g as f32) * m) as u8,
                    ((sky_b as f32) * m) as u8,
                    f32::INFINITY,
                )
            } else {
                let xh = eye_x + dx * t_hit;
                let yh = eye_y + dy * t_hit;
                let zh = eye_z + dz * t_hit;
                let (u, v) = match hit {
                    // Side faces: the horizontal texture axis is the OTHER
                    // horizontal world axis, flipped with the step sign so
                    // opposite faces of a cube are not mirror images. v runs
                    // down from the top of the block, so texture row 0 is up.
                    1 => {
                        let f = frac(zh);
                        (if stepx > 0 { f } else { 1.0f32 - f }, 1.0f32 - frac(yh))
                    }
                    2 => {
                        let f = frac(xh);
                        (if stepz > 0 { 1.0f32 - f } else { f }, 1.0f32 - frac(yh))
                    }
                    // Top face and floor are both seen from above, so both use
                    // the cell-local (x, z) — which is exactly how the
                    // top-down view already shows these textures.
                    _ => (frac(xh), frac(zh)),
                };
                let t = if tile < n_tiles { tile } else { 0 };
                let mut tx = (u * tpx) as i32;
                let mut ty = (v * tpx) as i32;
                if tx < 0 { tx = 0; }
                if tx > tmax { tx = tmax; }
                if ty < 0 { ty = 0; }
                if ty > tmax { ty = tmax; }
                let o = (t as usize) * tstride
                    + ((ty as usize) * (tile_px as usize) + (tx as usize)) * 4;
                let (tr, tg, tb) = unsafe {
                    (*atlas.add(o), *atlas.add(o + 1), *atlas.add(o + 2))
                };
                // Face shading. The depth buffer holds FORWARD distance for the
                // sprite pass (see this function's doc comment): the ray was
                // normalised by `len` and the unnormalised direction's forward
                // component is exactly 1, so forward = t / len.
                let shade = match hit {
                    1 => SHADE_X,
                    2 => SHADE_Z,
                    _ => SHADE_TOP,
                };
                (
                    ((tr as f32) * shade) as u8,
                    ((tg as f32) * shade) as u8,
                    ((tb as f32) * shade) as u8,
                    t_hit / len,
                )
            };

            let i = (cyp as usize) * cw + (cxp as usize);
            let o = i * 4;
            c.px[o] = r;
            c.px[o + 1] = g;
            c.px[o + 2] = b;
            c.px[o + 3] = 255;
            c.depth[i] = depth;
        }
    }
}


/// Draw an upright 1x1 billboard at cell centre (`sprite_x`, `sprite_z`),
/// depth-tested against the ray depths `rs_voxel_view` left in the canvas.
///
/// Classic sprite casting: the quad always faces the eye, so there is no
/// rotation and no perspective correction to get wrong — project the two
/// horizontal edges and the two vertical ones, then walk the rectangle.
///
/// Call this AFTER `rs_voxel_view` and BEFORE `rs_dusk`, which is the order
/// `80_render.js` composes the classic frame in (map, then sprites, then the
/// dusk pass over both).
///
/// Alpha is the tile's own, blended in f32 as `dst*(1-a) + tex*a` — the same
/// expression `_overTile` uses in `80_render.js`, though not the same
/// arithmetic: Craftax blends into a float32 buffer that stays float until the
/// end of the frame, while this blends into the uint8 canvas. Nothing here is
/// Craftax-exact by construction, so the simpler thing is the right thing;
/// what matters is that it is identical across backends.
///
/// Only a fully opaque texel writes depth. A partially transparent one blends
/// without occluding, so two overlapping sprites still compose.
///
/// Face shading is NOT applied: a billboard always faces the eye, so it has no
/// face to shade.
#[no_mangle]
pub extern "C" fn rs_voxel_sprite(
    canvas: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw_q: u32,
    view_dist: f32,
    sprite_x: f32,
    sprite_z: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    atlas_tile: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    let (fx, fz, rx, rz) = quarter_basis(yaw_q);
    sprite_with_basis(
        canvas, eye_x, eye_y, eye_z, fx, fz, rx, rz, view_dist, sprite_x, sprite_z,
        atlas, tile_px, n_tiles, atlas_tile, dst_x, dst_y, dst_w, dst_h,
    )
}

/// The same billboard, with a free yaw in radians. Display only — see
/// `rs_voxel_view_free`.
#[no_mangle]
pub extern "C" fn rs_voxel_sprite_free(
    canvas: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw: f32,
    view_dist: f32,
    sprite_x: f32,
    sprite_z: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    atlas_tile: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    let (fx, fz, rx, rz) = free_basis(yaw);
    sprite_with_basis(
        canvas, eye_x, eye_y, eye_z, fx, fz, rx, rz, view_dist, sprite_x, sprite_z,
        atlas, tile_px, n_tiles, atlas_tile, dst_x, dst_y, dst_w, dst_h,
    )
}

#[allow(clippy::too_many_arguments)]
fn sprite_with_basis(
    canvas: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    fwd_x: f32,
    fwd_z: f32,
    rgt_x: f32,
    rgt_z: f32,
    view_dist: f32,
    sprite_x: f32,
    sprite_z: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    atlas_tile: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if atlas.is_null() || tile_px == 0 || n_tiles == 0 || dst_w == 0 || dst_h == 0 {
        return;
    }
    let c = cv(canvas);
    let cw = c.dw;
    let ch = c.dh;
    if cw == 0 || ch == 0 {
        return;
    }
    // A sprite pass with no preceding view pass has nothing to test against.
    // Define it as "everything is infinitely far" rather than silently
    // drawing over whatever was in the buffer.
    if c.depth.len() != cw * ch {
        c.depth = vec![f32::INFINITY; cw * ch];
    }

    let dx = sprite_x - eye_x;
    let dz = sprite_z - eye_z;
    let depth = dx * fwd_x + dz * fwd_z;
    let lat = dx * rgt_x + dz * rgt_z;

    // Behind the eye, or past the draw distance.
    if !(depth > 0.0f32) || depth > view_dist {
        return;
    }

    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let hw = fw * 0.5f32;
    let hh = fh * 0.5f32;

    // Horizontal: the quad spans lat-0.5 .. lat+0.5. Screen x for a camera-
    // space lateral l is ((l/depth) + 1) * (w/2) - 0.5, the inverse of the
    // pixel-centre mapping rs_voxel_view builds its rays from.
    let x0f = ((lat - 0.5f32) / depth + 1.0f32) * hw - 0.5f32;
    let x1f = ((lat + 0.5f32) / depth + 1.0f32) * hw - 0.5f32;
    // Vertical: world y=1 is the top of the block, y=0 the floor.
    let y0f = (1.0f32 - (1.0f32 - eye_y) / depth) * hh - 0.5f32;
    let y1f = (1.0f32 - (0.0f32 - eye_y) / depth) * hh - 0.5f32;

    let wf = x1f - x0f;
    let hf = y1f - y0f;
    if !(wf > 0.0f32) || !(hf > 0.0f32) {
        return;
    }

    // Integer pixel centres inside the quad: ceil(lo) .. floor(hi).
    let mut ix0 = -ffloor(-x0f);
    let mut ix1 = ffloor(x1f);
    let mut iy0 = -ffloor(-y0f);
    let mut iy1 = ffloor(y1f);
    if ix0 < 0 { ix0 = 0; }
    if iy0 < 0 { iy0 = 0; }
    if ix1 > dst_w as i32 - 1 { ix1 = dst_w as i32 - 1; }
    if iy1 > dst_h as i32 - 1 { iy1 = dst_h as i32 - 1; }

    let t = if atlas_tile < n_tiles { atlas_tile } else { 0 };
    let tpx = tile_px as f32;
    let tmax = tile_px as i32 - 1;
    let tstride = (tile_px as usize) * (tile_px as usize) * 4;

    let mut py = iy0;
    while py <= iy1 {
        let cyp = dst_y as i32 + py;
        if cyp < 0 || cyp as usize >= ch {
            py += 1;
            continue;
        }
        let v = (py as f32 - y0f) / hf;
        let mut ty = (v * tpx) as i32;
        if ty < 0 { ty = 0; }
        if ty > tmax { ty = tmax; }

        let mut px = ix0;
        while px <= ix1 {
            let cxp = dst_x as i32 + px;
            if cxp < 0 || cxp as usize >= cw {
                px += 1;
                continue;
            }
            let i = (cyp as usize) * cw + (cxp as usize);
            if depth >= c.depth[i] {
                px += 1;
                continue;
            }
            let u = (px as f32 - x0f) / wf;
            let mut tx = (u * tpx) as i32;
            if tx < 0 { tx = 0; }
            if tx > tmax { tx = tmax; }

            let o = (t as usize) * tstride
                + ((ty as usize) * (tile_px as usize) + (tx as usize)) * 4;
            let (sr, sg, sb, sa) = unsafe {
                (*atlas.add(o), *atlas.add(o + 1), *atlas.add(o + 2), *atlas.add(o + 3))
            };
            if sa == 0 {
                px += 1;
                continue;
            }
            let d = i * 4;
            if sa == 255 {
                c.px[d] = sr;
                c.px[d + 1] = sg;
                c.px[d + 2] = sb;
                c.px[d + 3] = 255;
                c.depth[i] = depth;
            } else {
                let a = (sa as f32) / 255.0f32;
                let ia = 1.0f32 - a;
                c.px[d] = ((c.px[d] as f32) * ia + (sr as f32) * a) as u8;
                c.px[d + 1] = ((c.px[d + 1] as f32) * ia + (sg as f32) * a) as u8;
                c.px[d + 2] = ((c.px[d + 2] as f32) * ia + (sb as f32) * a) as u8;
                c.px[d + 3] = 255;
            }
            px += 1;
        }
        py += 1;
    }
}


// ------------------------------------------------------------------ dusk ---
// Craftax's dusk pass, and the per-pixel night static it draws below
// light_level 0.5 (FIRST_PERSON_PLAN.md §4.4, option A).
//
// The formula and its operation ORDER come from `80_render.js`, which is in
// turn Craftax's `render_craftax_pixels` reproduced bit for bit. The order is
// load-bearing: f32 addition is not associative, and the classic port's
// comments record a case where regrouping one product flipped a truncated
// channel on 1 pixel in 74 night frames. Do not "simplify" any expression here.
//
// One thing is NOT Craftax's, unavoidably: Craftax composites into a float32
// buffer that stays float for the whole frame, while this reads and writes the
// uint8 canvas, so each pass is quantised at its boundary. The first-person
// frame has nothing to be exact against, so the simpler thing is the right
// thing; what has to hold is that every backend agrees, which is what the
// goldens and the wasm check assert.

// Craftax's night constants, as f32 literals. `ENHANCE_INV` is 1 - 0.4
// computed in double and then rounded, which is what Python does before JAX
// sees it — not `1.0f32 - 0.4f32`.
const ENHANCE: f32 = 0.4;
const ENHANCE_INV: f32 = 0.6;
const LUM_R: f32 = 0.299;
const LUM_G: f32 = 0.587;
const LUM_B: f32 = 0.114;
const NIGHT_TINT: [f32; 3] = [0.0, 16.0, 64.0];
const SLEEP_TINT: [f32; 3] = [0.0, 0.0, 16.0];

// --- JAX's threefry-2x32, ported from 16_threefry.js -----------------------
// Pure u32 arithmetic, so native and wasm agree by construction. The JS is the
// spec; `dusk_threefry_matches_the_js_port` pins a vector of its output.
const THREEFRY_C240: u32 = 0x1BD1_1BDA;

#[inline]
fn rotl32(x: u32, r: u32) -> u32 {
    (x << r) | (x >> (32 - r))
}

/// Threefry-2x32 of counter (x0, x1) under key (k0, k1): 20 rounds in five
/// groups of four, with the key injected after each group.
#[inline]
fn threefry2x32(k0: u32, k1: u32, x0: u32, x1: u32) -> (u32, u32) {
    let ks0 = k0;
    let ks1 = k1;
    let ks2 = ks0 ^ ks1 ^ THREEFRY_C240;
    let mut v0 = x0.wrapping_add(ks0);
    let mut v1 = x1.wrapping_add(ks1);

    const ROT: [[u32; 4]; 2] = [[13, 15, 26, 6], [17, 29, 16, 24]];
    // Key schedule: after group g (0-based) inject (ks[(g+1)%3], ks[(g+2)%3])
    // and add g+1 to the second word.
    let ks = [ks0, ks1, ks2];
    let mut g = 0usize;
    while g < 5 {
        let rots = ROT[g & 1];
        let mut i = 0usize;
        while i < 4 {
            v0 = v0.wrapping_add(v1);
            v1 = rotl32(v1, rots[i]);
            v1 = v0 ^ v1;
            i += 1;
        }
        v0 = v0.wrapping_add(ks[(g + 1) % 3]);
        v1 = v1.wrapping_add(ks[(g + 2) % 3]).wrapping_add(g as u32 + 1);
        g += 1;
    }
    (v0, v1)
}

/// `jax.random.uniform(key, (n,))[i]` as f32 in [0, 1), partitionable layout:
/// element i is threefry(key, 0, i) with the two output words XORed, then the
/// top 23 bits become the mantissa of a float in [1, 2), minus 1.
#[inline]
fn threefry_uniform_at(k0: u32, k1: u32, i: u32) -> f32 {
    let (a, b) = threefry2x32(k0, k1, 0, i);
    let bits = a ^ b;
    f32::from_bits((bits >> 9) | 0x3f80_0000) - 1.0f32
}

/// Pointer to a staging buffer of at least `n` f32s, for the night-noise
/// intensity texture. Same reason as `rs_voxel_grid_ptr`: JS cannot make a
/// pointer into wasm linear memory.
#[no_mangle]
pub extern "C" fn rs_voxel_noise_ptr(n: u32) -> *mut f32 {
    let v = vx();
    if v.noise.len() < n as usize {
        v.noise.resize(n as usize, 0.0);
    }
    v.noise.as_mut_ptr()
}

/// Apply Craftax's dusk pass, and then its sleep tint, over the rect
/// (`x`, `y`, `w`, `h`) of `canvas`.
///
/// `daylight` is the state's `light_level`. Below 1.0 the dusk blend runs;
/// below 0.5, and only when `use_static` is non-zero (the host has a driver
/// seed), the per-pixel static is drawn from `jax.random.uniform` under key
/// (`key0`, `key1`) and masked by `intensity`, which must hold `w * h` f32s
/// row-major. `sleeping` applies the sleep tint afterwards, as a separate
/// pass, exactly as `80_render.js` does.
///
/// Call after `rs_voxel_view` and `rs_voxel_sprite`: Craftax darkens the
/// composited world, mobs included.
#[no_mangle]
pub extern "C" fn rs_dusk(
    canvas: u32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    daylight: f32,
    key0: u32,
    key1: u32,
    use_static: u32,
    intensity: *const f32,
    sleeping: u32,
) {
    if w == 0 || h == 0 {
        return;
    }
    let c = cv(canvas);
    let cw = c.dw;
    let ch = c.dh;
    if cw == 0 || ch == 0 {
        return;
    }
    let with_static = daylight < 0.5f32 && use_static != 0 && !intensity.is_null();
    let do_dusk = daylight < 1.0f32;
    if !do_dusk && sleeping == 0 {
        return;
    }
    let inv = 1.0f32 - daylight;
    // night_static_intensity = max(2 * (0.5 - daylight), 0); positive here.
    let si = 2.0f32 * (0.5f32 - daylight);

    let mut py = 0u32;
    while py < h {
        let cyp = y + py;
        if cyp as usize >= ch {
            py += 1;
            continue;
        }
        let mut px = 0u32;
        while px < w {
            let cxp = x + px;
            if cxp as usize >= cw {
                px += 1;
                continue;
            }
            let i = (py * w + px) as usize;
            let o = ((cyp as usize) * cw + (cxp as usize)) * 4;

            if do_dusk {
                let r0 = c.px[o] as f32;
                let g0 = c.px[o + 1] as f32;
                let b0 = c.px[o + 2] as f32;
                let (mut r1, mut g1, mut b1) = (r0, g0, b0);
                if with_static {
                    // night_with_static = uniform * 95 + 32
                    // mask = intensity * night_noise_intensity_texture
                    // night_pixels = (1 - mask) * map + mask * night_with_static
                    let u = threefry_uniform_at(key0, key1, i as u32);
                    let sv = u * 95.0f32 + 32.0f32;
                    let m = si * unsafe { *intensity.add(i) };
                    let im = 1.0f32 - m;
                    r1 = im * r0 + m * sv;
                    g1 = im * g0 + m * sv;
                    b1 = im * b0 + m * sv;
                }
                let lum = LUM_R * r1 + LUM_G * g1 + LUM_B * b1;
                let mut nr = r1 * ENHANCE + ENHANCE_INV * lum;
                let mut ng = g1 * ENHANCE + ENHANCE_INV * lum;
                let mut nb = b1 * ENHANCE + ENHANCE_INV * lum;
                nr = 0.5f32 * nr + 0.5f32 * NIGHT_TINT[0];
                ng = 0.5f32 * ng + 0.5f32 * NIGHT_TINT[1];
                nb = 0.5f32 * nb + 0.5f32 * NIGHT_TINT[2];
                c.px[o] = (daylight * r0 + inv * nr) as u8;
                c.px[o + 1] = (daylight * g0 + inv * ng) as u8;
                c.px[o + 2] = (daylight * b0 + inv * nb) as u8;
            }

            if sleeping != 0 {
                let r = c.px[o] as f32;
                let g = c.px[o + 1] as f32;
                let b = c.px[o + 2] as f32;
                let lum = LUM_R * r + LUM_G * g + LUM_B * b;
                c.px[o] = (0.5f32 * lum + 0.5f32 * SLEEP_TINT[0]) as u8;
                c.px[o + 1] = (0.5f32 * lum + 0.5f32 * SLEEP_TINT[1]) as u8;
                c.px[o + 2] = (0.5f32 * lum + 0.5f32 * SLEEP_TINT[2]) as u8;
            }
            px += 1;
        }
        py += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TILE_PX: u32 = 16;
    const N_TILES: u32 = 4;
    const GW: u32 = 16;
    const GH: u32 = 16;
    const SKY: u32 = 0x87CEEB;
    const VIEW: f32 = 9.0;
    // The frame layout of plan §4.5: the first-person view occupies rows
    // 0..48 of the 64x64 observation, with the inventory strip below it.
    const DST: (u32, u32, u32, u32) = (0, 0, 64, 49);

    // A synthetic atlas with no symmetry in any direction, so that a mirrored
    // or transposed UV changes the hash instead of hiding in a pretty tile.
    fn atlas_bytes() -> Vec<u8> {
        let mut a = vec![0u8; (N_TILES * TILE_PX * TILE_PX * 4) as usize];
        for t in 0..N_TILES {
            for y in 0..TILE_PX {
                for x in 0..TILE_PX {
                    let o = ((t * TILE_PX * TILE_PX + y * TILE_PX + x) * 4) as usize;
                    a[o] = ((t * 61 + x * 13 + y * 7) & 255) as u8;
                    a[o + 1] = ((t * 97 + x * 5 + y * 29) & 255) as u8;
                    a[o + 2] = ((t * 131 + x * 23 + y * 3) & 255) as u8;
                    a[o + 3] = 255;
                }
            }
        }
        a
    }

    #[inline]
    fn cell(tile: u16, solid: bool) -> u16 {
        (tile << 1) | (solid as u16)
    }

    // Sprites drawn after the view, as (x, z, tile). Craftax's mobs stand at
    // cell centres, so these do too.
    fn sprites(name: &str) -> Vec<(f32, f32, u32)> {
        match name {
            // One near, one far, one behind the eye (must not draw), and one
            // tucked behind the north wall (must be occluded by the depth
            // buffer, which is the whole point of the pass).
            "sprites" | "night_static" => vec![
                (8.5, 7.5, 1),
                (8.5, 4.5, 2),
                (8.5, 12.5, 3),
                (10.5, 6.5, 0),
            ],
            _ => Vec::new(),
        }
    }

    // (grid, eye, yaw) for each golden scene.
    fn scene(name: &str) -> (Vec<u16>, (f32, f32, f32), u32) {
        let eye = (8.5f32, 0.5f32, 9.5f32);
        match name {
            // Nothing solid anywhere: floor below the horizon, sky above it.
            "open_field" => (vec![cell(0, false); (GW * GH) as usize], eye, 0),
            // Two solid walls either side of the player's column, running the
            // length of the map — the case where side faces dominate.
            "corridor" => {
                let mut g = vec![cell(2, false); (GW * GH) as usize];
                for r in 0..GH {
                    g[(r * GW + 7) as usize] = cell(1, true);
                    g[(r * GW + 9) as usize] = cell(1, true);
                }
                (g, eye, 0)
            }
            // A room with a differently textured wall on each side, and the
            // eye off-centre, so the four yaws cannot hash alike by symmetry.
            _ => {
                let mut g = vec![cell(0, false); (GW * GH) as usize];
                for c in 5..12 {
                    g[(5 * GW + c) as usize] = cell(0, true); // north
                    g[(11 * GW + c) as usize] = cell(2, true); // south
                }
                for r in 5..12 {
                    g[(r * GW + 11) as usize] = cell(1, true); // east
                    g[(r * GW + 5) as usize] = cell(3, true); // west
                }
                let q = if name == "sprites" || name == "night_static" { 0 }
                        else { (name.as_bytes()[name.len() - 1] - b'0') as u32 };
                (g, eye, q)
            }
        }
    }

    const SCENES: [&str; 8] = [
        "open_field",
        "corridor",
        "wall_yaw0",
        "wall_yaw1",
        "wall_yaw2",
        "wall_yaw3",
        "sprites",
        "night_static",
    ];

    // Dusk parameters per scene: (daylight, key, sleeping). None = no dusk
    // pass at all, which is what a fully lit frame does.
    fn dusk_params(name: &str) -> Option<(f32, Option<(u32, u32)>, u32)> {
        match name {
            // Below 0.5 with a key, so the static branch runs, and asleep, so
            // the second pass runs too — one scene covering both.
            "night_static" => Some((0.2, Some((0x12345678, 0x9abcdef0)), 1)),
            _ => None,
        }
    }

    // A night-noise intensity texture with structure, so a transposed or
    // mis-strided index changes the image instead of hiding in a flat field.
    fn noise_bytes() -> Vec<f32> {
        let mut v = vec![0.0f32; (DST.2 * DST.3) as usize];
        for row in 0..DST.3 {
            for col in 0..DST.2 {
                let i = (row * DST.2 + col) as usize;
                v[i] = ((row * 7 + col * 13) % 100) as f32 / 100.0f32;
            }
        }
        v
    }

    fn fnv(px: &[u8]) -> u64 {
        let mut h: u64 = 1469598103934665603;
        for &b in px {
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
        h
    }

    fn b64(bytes: &[u8]) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::new();
        for ch in bytes.chunks(3) {
            let b0 = ch[0] as u32;
            let b1 = if ch.len() > 1 { ch[1] as u32 } else { 0 };
            let b2 = if ch.len() > 2 { ch[2] as u32 } else { 0 };
            let n = (b0 << 16) | (b1 << 8) | b2;
            s.push(T[(n >> 18) as usize & 63] as char);
            s.push(T[(n >> 12) as usize & 63] as char);
            s.push(if ch.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
            s.push(if ch.len() > 2 { T[n as usize & 63] as char } else { '=' });
        }
        s
    }

    // Fresh per-test env state; tests run on several threads.
    fn fresh() -> u32 {
        let st = crate::rs_state_new();
        crate::rs_state_select(st);
        crate::rs_new_canvas(64.0, 64.0, 64.0, 64.0)
    }

    fn render(h: u32, g: &[u16], eye: (f32, f32, f32), yaw: u32, a: &[u8]) {
        rs_voxel_view(
            h, g.as_ptr(), GW, GH, eye.0, eye.1, eye.2, yaw, VIEW,
            a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3,
        );
    }

    fn render_all(h: u32, name: &str, g: &[u16], eye: (f32, f32, f32), yaw: u32, a: &[u8]) {
        render(h, g, eye, yaw, a);
        for (sx, sz, tile) in sprites(name) {
            rs_voxel_sprite(
                h, eye.0, eye.1, eye.2, yaw, VIEW, sx, sz,
                a.as_ptr(), TILE_PX, N_TILES, tile, DST.0, DST.1, DST.2, DST.3,
            );
        }
        if let Some((daylight, key, sleeping)) = dusk_params(name) {
            let noise = noise_bytes();
            let (k0, k1) = key.unwrap_or((0, 0));
            rs_dusk(
                h, DST.0, DST.1, DST.2, DST.3, daylight, k0, k1,
                key.is_some() as u32, noise.as_ptr(), sleeping,
            );
        }
    }

    fn scene_hash(name: &str) -> u64 {
        let (g, eye, yaw) = scene(name);
        let a = atlas_bytes();
        let h = fresh();
        render_all(h, name, &g, eye, yaw, &a);
        let px = &crate::cv(h).px;
        let hh = fnv(px);
        if let Ok(p) = std::env::var("VOXEL_SCENES_OUT") {
            let line = format!(
                "{{\"name\":\"{}\",\"hash\":\"{}\",\"gw\":{},\"gh\":{},\"grid\":[{}],\
                 \"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\
                 \"sky\":{},\"dst\":[{},{},{},{}],\"sprites\":[{}],\"dusk\":{},\"noise\":\"{}\",\"atlas\":\"{}\"}}\n",
                name, hh, GW, GH,
                g.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
                eye.0, eye.1, eye.2, yaw, VIEW, TILE_PX, N_TILES, SKY,
                DST.0, DST.1, DST.2, DST.3,
                sprites(name).iter().map(|s| format!("[{},{},{}]", s.0, s.1, s.2))
                    .collect::<Vec<_>>().join(","),
                match dusk_params(name) {
                    None => "null".to_string(),
                    Some((d, k, sl)) => format!(
                        "[{},{},{},{},{}]", d,
                        k.map(|x| x.0).unwrap_or(0), k.map(|x| x.1).unwrap_or(0),
                        k.is_some() as u32, sl),
                },
                if dusk_params(name).is_some() {
                    let n = noise_bytes();
                    let mut raw = Vec::with_capacity(n.len() * 4);
                    for v in &n { raw.extend_from_slice(&v.to_bits().to_le_bytes()); }
                    b64(&raw)
                } else { String::new() },
                b64(&a),
            );
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        hh
    }

    // Not a gate by itself — it pins the geometry in terms a human can check,
    // so that a hash change can be read as "what moved" rather than "it moved".
    #[test]
    fn open_field_is_floor_below_sky_above() {
        let (g, eye, yaw) = scene("open_field");
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, eye, yaw, &a);
        let px = &crate::cv(h).px;
        let sky = [
            ((SKY >> 16) & 255) as u8,
            ((SKY >> 8) & 255) as u8,
            (SKY & 255) as u8,
        ];
        // The sky is a vertical GRADIENT, not a flat fill, so nothing above the
        // horizon equals SKY_RGB exactly except the horizon row itself. What
        // holds: every sky row is flat ACROSS the row, rows get brighter going
        // down toward the horizon, and no sky pixel is brighter than SKY_RGB.
        let at = |r: usize, c: usize| {
            let o = (r * 64 + c) * 4;
            [px[o], px[o + 1], px[o + 2]]
        };
        let top = at(2, 32);
        let near_horizon = at(20, 32);
        assert_eq!(at(2, 5), top, "the sky is not flat across a row");
        assert_eq!(at(2, 60), top, "the sky is not flat across a row");
        assert!(
            top[2] < near_horizon[2],
            "sky should brighten toward the horizon: top {:?} vs row 20 {:?}",
            top, near_horizon,
        );
        for (c, s) in top.iter().zip(sky.iter()) {
            assert!(c <= s, "sky {:?} is brighter than SKY_RGB {:?}", top, sky);
        }
        let bot = (46 * 64 + 32) * 4;
        assert_ne!(&px[bot..bot + 3], &sky[..], "below the horizon must be floor");
        // Rows 49..63 are outside the dst rect and must be untouched.
        let below = (50 * 64 + 32) * 4;
        assert_eq!(&px[below..below + 4], &[0, 0, 0, 0], "wrote outside the dst rect");
        // The depth buffer: sky is +inf, floor is finite and within view_dist.
        let d = &crate::cv(h).depth;
        assert!(d[2 * 64 + 32].is_infinite());
        assert!(d[46 * 64 + 32].is_finite() && d[46 * 64 + 32] <= VIEW);
    }

    #[test]
    fn corridor_walls_are_nearer_than_the_floor() {
        let (g, eye, yaw) = scene("corridor");
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, eye, yaw, &a);
        let d = &crate::cv(h).depth;
        // Just below the horizon at the left edge looks along the near wall;
        // straight down the middle of the corridor is floor stretching away.
        let edge = d[24 * 64 + 1];
        assert!(edge.is_finite(), "corridor wall should be hit at the frame edge");
        assert!(edge < VIEW, "wall depth {} beyond view_dist", edge);
    }

    // The four yaws must give four different frames: a camera that ignored
    // yaw, or applied it twice, would collapse some of these.
    #[test]
    fn yaws_differ() {
        let a = atlas_bytes();
        let mut hs = Vec::new();
        for q in 0..4 {
            let (g, eye, yaw) = scene(&format!("wall_yaw{}", q));
            let h = fresh();
            render(h, &g, eye, yaw, &a);
            hs.push(fnv(&crate::cv(h).px));
        }
        for i in 0..4 {
            for j in (i + 1)..4 {
                assert_ne!(hs[i], hs[j], "yaw {} and yaw {} rendered identically", i, j);
            }
        }
    }

    // Repeated calls must be stable and must not allocate.
    #[test]
    fn frame_repeat_is_stable_and_alloc_free() {
        let (g, eye, yaw) = scene("corridor");
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, eye, yaw, &a);
        let h1 = fnv(&crate::cv(h).px);
        let cap = crate::cv(h).depth.capacity();
        for _ in 0..3 {
            render(h, &g, eye, yaw, &a);
        }
        assert_eq!(h1, fnv(&crate::cv(h).px));
        assert_eq!(cap, crate::cv(h).depth.capacity(), "per-call path grew the depth buffer");
    }

    // The staging buffers grow once and then stay put.
    #[test]
    fn staging_buffers_are_stable() {
        crate::rs_state_select(crate::rs_state_new());
        let p0 = rs_voxel_grid_ptr(4096);
        let p1 = rs_voxel_grid_ptr(4096);
        assert_eq!(p0, p1);
        let a0 = rs_voxel_atlas_ptr(65536);
        let a1 = rs_voxel_atlas_ptr(65536);
        assert_eq!(a0, a1);
    }

    // --- the sprite pass ---------------------------------------------------
    // The golden above pins whatever the pass does; these say what it should
    // do, in terms a human can check.

    // Count the pixels a sprite of `tile` at (sx, sz) changes, from the room
    // scene at yaw 0.
    fn sprite_changed(sx: f32, sz: f32, tile: u32) -> usize {
        let (g, eye, yaw) = scene("wall_yaw0");
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, eye, yaw, &a);
        let before = crate::cv(h).px.clone();
        rs_voxel_sprite(
            h, eye.0, eye.1, eye.2, yaw, VIEW, sx, sz,
            a.as_ptr(), TILE_PX, N_TILES, tile, DST.0, DST.1, DST.2, DST.3,
        );
        let after = &crate::cv(h).px;
        (0..before.len() / 4).filter(|i| before[i * 4..i * 4 + 3] != after[i * 4..i * 4 + 3]).count()
    }

    #[test]
    fn a_sprite_in_front_of_the_eye_draws() {
        // Eye is at z 9.5 facing -z, so z 7.5 is two blocks ahead.
        assert!(sprite_changed(8.5, 7.5, 1) > 0, "a sprite ahead drew nothing");
    }

    #[test]
    fn a_nearer_sprite_is_bigger() {
        let near = sprite_changed(8.5, 8.5, 1);
        let far = sprite_changed(8.5, 6.5, 1);
        assert!(near > far, "near {} should cover more than far {}", near, far);
    }

    #[test]
    fn a_sprite_behind_the_eye_does_not_draw() {
        // Facing -z from z 9.5, so z 11.5 is behind.
        assert_eq!(sprite_changed(8.5, 11.5, 1), 0, "a sprite behind the eye drew");
    }

    #[test]
    fn a_sprite_beyond_view_dist_does_not_draw() {
        assert_eq!(sprite_changed(8.5, -2.5, 1), 0, "a sprite past view_dist drew");
    }

    #[test]
    fn a_sprite_behind_a_wall_is_occluded() {
        // The room's north wall is the row at r = 5; anything past it is hidden.
        // Without the depth test this would paint over the wall.
        assert_eq!(sprite_changed(8.5, 3.5, 1), 0, "the depth test did not occlude a sprite");
    }

    #[test]
    fn the_sprite_pass_needs_no_view_pass_to_be_safe() {
        // Defined behaviour on a canvas rs_voxel_view never touched: the depth
        // buffer is created as +inf and the sprite simply draws.
        let a = atlas_bytes();
        let h = fresh();
        rs_voxel_sprite(
            h, 8.5, 0.5, 9.5, 0, VIEW, 8.5, 7.5,
            a.as_ptr(), TILE_PX, N_TILES, 1, DST.0, DST.1, DST.2, DST.3,
        );
        assert!(crate::cv(h).px.iter().any(|&b| b != 0), "nothing drew");
    }

    // The depth buffer holds FORWARD distance, not Euclidean. A wall row
    // perpendicular to the view is the same forward distance from the eye at
    // every pixel that hits it, so its stored depth must be CONSTANT across
    // the whole wall. Under Euclidean depth it would fan out by up to sqrt(3)
    // toward the corners, and a billboard — whose depth is naturally a forward
    // distance — could then draw through it near the frame edges.
    #[test]
    fn wall_depth_is_constant_across_a_flat_wall() {
        let mut g = vec![cell(0, false); (GW * GH) as usize];
        for c in 0..GW {
            g[(4 * GW + c) as usize] = cell(1, true);
        }
        let a = atlas_bytes();
        let h = fresh();
        // Eye at z 9.5 facing -z; the wall's near face is z = 5, forward 4.5.
        render(h, &g, (8.5, 0.5, 9.5), 0, &a);
        let d = &crate::cv(h).depth;
        let mut seen: Vec<f32> = Vec::new();
        for py in 0..24 {
            for px in 0..64 {
                let v = d[py * 64 + px];
                if v.is_finite() {
                    seen.push(v);
                }
            }
        }
        assert!(seen.len() > 100, "only {} wall pixels above the horizon", seen.len());
        let lo = seen.iter().cloned().fold(f32::INFINITY, f32::min);
        let hi = seen.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        // Not a bit-for-bit compare, and deliberately so: `t / len` rounds, so
        // the constant comes out as 4.4999995 on some pixels and 4.5 on
        // others — one ULP. What the test discriminates is the SHAPE of the
        // error. Forward depth is flat to within a few ULP; Euclidean depth
        // would fan out toward the corners by up to sqrt(3) ~ 1.73x, which is
        // five orders of magnitude bigger than anything rounding can explain.
        // (Cross-backend bit-exactness is a separate gate: wasm_voxel_check.)
        assert!(hi / lo < 1.0001, "wall depth fans out {}..{} across the wall — that is Euclidean depth, not forward", lo, hi);
        assert!((lo - 4.5f32).abs() < 1.0e-4, "wall forward distance should be 4.5, got {}", lo);
    }

    // A billboard shrinks with distance and never vanishes inside view_dist.
    // The d=3 case is the one worth having: in a real Craftax world a mob three
    // cells away is often hidden behind a tree, which looks exactly like a
    // broken sprite pass until you check it against an empty field.
    #[test]
    fn sprite_falloff_is_smooth_in_an_open_field() {
        let a = atlas_bytes();
        let g = vec![cell(0, false); (GW * GH) as usize];
        let mut last = usize::MAX;
        for d in 1..9 {
            let h = fresh();
            render(h, &g, (8.5, 0.5, 9.5), 0, &a);
            let before = crate::cv(h).px.clone();
            rs_voxel_sprite(
                h, 8.5, 0.5, 9.5, 0, VIEW, 8.5, 9.5 - d as f32,
                a.as_ptr(), TILE_PX, N_TILES, 1, DST.0, DST.1, DST.2, DST.3,
            );
            let after = &crate::cv(h).px;
            let n = (0..before.len() / 4)
                .filter(|i| before[i * 4..i * 4 + 3] != after[i * 4..i * 4 + 3])
                .count();
            assert!(n > 0, "sprite at forward distance {} drew nothing in an open field", d);
            assert!(n <= last, "sprite at distance {} covers {} px, more than {} at the step before", d, n, last);
            last = n;
        }
    }

    // Off-axis occlusion: a sprite beyond the wall, well away from the centre
    // of the frame, must still be hidden. This is the case the forward-depth
    // fix is for.
    #[test]
    fn a_sprite_behind_a_wall_is_occluded_off_axis() {
        let mut g = vec![cell(0, false); (GW * GH) as usize];
        for c in 0..GW {
            g[(4 * GW + c) as usize] = cell(1, true);
        }
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, (8.5, 0.5, 9.5), 0, &a);
        let before = crate::cv(h).px.clone();
        // forward 5.0, lateral +3.0 -> screen x well off centre, and past the
        // wall at forward 4.5.
        rs_voxel_sprite(
            h, 8.5, 0.5, 9.5, 0, VIEW, 11.5, 4.5,
            a.as_ptr(), TILE_PX, N_TILES, 1, DST.0, DST.1, DST.2, DST.3,
        );
        let after = &crate::cv(h).px;
        let n = (0..before.len() / 4)
            .filter(|i| before[i * 4..i * 4 + 3] != after[i * 4..i * 4 + 3])
            .count();
        assert_eq!(n, 0, "{} pixels of a sprite behind the wall drew off-axis", n);
    }

    // --- dusk and the night static ------------------------------------------

    // The Rust threefry must be the JS one, bit for bit.
    //
    // FIRST_PERSON_PLAN.md §4.4 says to validate this "against jax_uniform.json
    // the same way the JS was". There is no such file, and that is not how the
    // JS was validated: `16_threefry.js` is checked by
    // craftax_classic/tests/test_render.py, which renders whole NIGHT frames
    // and compares them byte for byte with Craftax's own
    // `render_craftax_pixels` output in traces/craftax_pixels/ (>= 8 night
    // frames, each carrying the driver seed Craftax was run with). The static
    // is inside those pixels, so that test is the ground truth.
    //
    // So the chain is Rust == JS == Craftax, and this is the first link: these
    // vectors were printed by the JS `threefryUniformF32` itself. The plan has
    // been corrected in the same commit.
    #[test]
    fn threefry_uniform_matches_the_js_port() {
        let cases: [((u32, u32), [u32; 8]); 4] = [
            ((0x00000000, 0x00000001), [0x3ee09470, 0x3f08a408, 0x3ee44f68, 0x3ee0757c, 0x3f65b992, 0x3f0f1716, 0x3f7bdfec, 0x3f578cb8]),
            ((0x00000000, 0x0000002a), [0x3efa3824, 0x3f2e0730, 0x3f1dc3f8, 0x3f0f9ec0, 0x3ee6bae4, 0x3f15fb4e, 0x3d9935b0, 0x3f466f24]),
            ((0x12345678, 0x9abcdef0), [0x3e9b26e0, 0x3e144320, 0x3f4940ec, 0x3f0bff38, 0x3ddaec10, 0x3f44597e, 0x3e90663c, 0x3e256878]),
            ((0xffffffff, 0xffffffff), [0x3d761820, 0x3f5c33f6, 0x3ee35944, 0x3eb3969c, 0x3f13a254, 0x3e4c9c90, 0x3bfef700, 0x3a846400]),
        ];
        for ((k0, k1), want) in cases {
            for i in 0..8u32 {
                let got = threefry_uniform_at(k0, k1, i).to_bits();
                assert_eq!(
                    got, want[i as usize],
                    "uniform(key {:08x}{:08x})[{}] = {:08x}, JS says {:08x}",
                    k0, k1, i, got, want[i as usize],
                );
            }
        }
    }

    #[test]
    fn uniform_is_in_range_and_not_constant() {
        let mut lo = f32::INFINITY;
        let mut hi = f32::NEG_INFINITY;
        for i in 0..4096u32 {
            let v = threefry_uniform_at(7, 9, i);
            assert!((0.0..1.0).contains(&v), "uniform out of [0,1): {}", v);
            if v < lo { lo = v; }
            if v > hi { hi = v; }
        }
        assert!(lo < 0.01 && hi > 0.99, "uniform spans only {}..{}", lo, hi);
    }

    // Helper: render the corridor, then run dusk over the view rect.
    fn dusk_frame(daylight: f32, key: Option<(u32, u32)>, sleeping: u32) -> Vec<u8> {
        let (g, eye, yaw) = scene("corridor");
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, eye, yaw, &a);
        let noise = vec![1.0f32; (DST.2 * DST.3) as usize];
        let (k0, k1) = key.unwrap_or((0, 0));
        rs_dusk(
            h, DST.0, DST.1, DST.2, DST.3, daylight, k0, k1,
            key.is_some() as u32, noise.as_ptr(), sleeping,
        );
        crate::cv(h).px.clone()
    }

    #[test]
    fn full_daylight_leaves_the_frame_alone() {
        let plain = {
            let (g, eye, yaw) = scene("corridor");
            let a = atlas_bytes();
            let h = fresh();
            render(h, &g, eye, yaw, &a);
            crate::cv(h).px.clone()
        };
        assert_eq!(plain, dusk_frame(1.0, None, 0), "dusk at daylight 1.0 changed pixels");
    }

    #[test]
    fn dusk_darkens_and_tints_blue() {
        let day = dusk_frame(1.0, None, 0);
        let night = dusk_frame(0.2, None, 0);
        assert_ne!(day, night, "dusk at daylight 0.2 changed nothing");
        // The tint is [0, 16, 64]: blue survives best, red least.
        let sum = |px: &[u8], c: usize| px.chunks_exact(4).map(|p| p[c] as u64).sum::<u64>();
        assert!(sum(&night, 0) < sum(&day, 0), "dusk did not darken red");
        assert!(sum(&night, 2) * 100 > sum(&night, 0) * 100, "blue should survive dusk better than red");
    }

    // The gate the plan names: a night frame with static must differ from the
    // same frame without it. Without the driver seed there is no key and the
    // static is skipped, which is exactly what every host does today.
    #[test]
    fn the_night_static_actually_changes_the_frame() {
        let no_key = dusk_frame(0.2, None, 0);
        let with_key = dusk_frame(0.2, Some((12345, 67890)), 0);
        assert_ne!(no_key, with_key, "the night static changed nothing at daylight 0.2");
        let other_key = dusk_frame(0.2, Some((99, 100)), 0);
        assert_ne!(with_key, other_key, "two different state_rng keys gave the same static");
    }

    #[test]
    fn the_static_is_skipped_at_and_above_half_daylight() {
        // night_static_intensity is max(2 * (0.5 - daylight), 0), so at 0.5 and
        // above there is no static even with a key.
        assert_eq!(
            dusk_frame(0.5, None, 0),
            dusk_frame(0.5, Some((12345, 67890)), 0),
            "static drew at daylight 0.5, where its intensity is zero",
        );
    }

    #[test]
    fn sleeping_greys_the_frame_toward_blue() {
        let awake = dusk_frame(1.0, None, 0);
        let asleep = dusk_frame(1.0, None, 1);
        assert_ne!(awake, asleep, "the sleep tint changed nothing");
        // SLEEP_TINT is [0, 0, 16]: r and g become lum/2, b becomes lum/2 + 8.
        for p in asleep.chunks_exact(4).take(2000) {
            assert_eq!(p[0], p[1], "sleep pass should leave r == g");
            assert!(p[2] >= p[0], "sleep pass should not make blue the darkest channel");
        }
    }

    // --- the goldens -------------------------------------------------------
    // Recorded 2026-09-15 on aarch64-apple-darwin (rustc 1.97.1) and matched
    // by the wasm32 build the same day (tests/wasm_voxel_check.mjs).
    const GOLD: [u64; 8] = [
        8361616621424232347,
        13946021819558816857,
        5794932247104989369,
        17953496414654206812,
        10543094387041738035,
        11322899486815878977,
        13604251051551303766,
        5065169466646613655,
    ];

    // All six are hashed before anything is asserted, so a real regression
    // reports every scene it moved instead of only the first.
    #[test]
    fn goldens() {
        let got: Vec<u64> = SCENES.iter().map(|n| scene_hash(n)).collect();
        let bad: Vec<String> = SCENES
            .iter()
            .enumerate()
            .filter(|(i, _)| got[*i] != GOLD[*i])
            .map(|(i, n)| format!("{} got {} want {}", n, got[i], GOLD[i]))
            .collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // `cargo test --release bench_voxel -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_voxel() {
        let (g, eye, yaw) = scene("corridor");
        let a = atlas_bytes();
        let h = fresh();
        for _ in 0..200 {
            render(h, &g, eye, yaw, &a);
        }
        let n = 3000;
        let t = std::time::Instant::now();
        for _ in 0..n {
            render(h, &g, eye, yaw, &a);
        }
        let us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
        eprintln!("BENCH_VOXEL {:.2} us/frame", us);
    }
}

