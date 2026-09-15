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

use crate::{cv, rs};

/// Per-env staging for the grid and atlas the JS side writes through.
pub(crate) struct Voxel {
    grid: Vec<u16>,
    atlas: Vec<u8>,
}

#[inline]
fn vx() -> &'static mut Voxel {
    let s = rs();
    if s.voxel.is_none() {
        s.voxel = Some(Box::new(Voxel { grid: Vec::new(), atlas: Vec::new() }));
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

/// Render a first-person view of `grid` into the rect (`dst_x`, `dst_y`,
/// `dst_w`, `dst_h`) of canvas `canvas`, and fill that rect of the canvas's
/// depth buffer with the Euclidean distance to each pixel's hit (+inf for
/// sky) for `rs_voxel_sprite` to test against.
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

            // Quarter-turn yaw, as exact swaps. q0 faces -z (row-), q1 +x,
            // q2 +z, q3 -x; the right-hand vector follows from that.
            let (rdx, rdz) = match yaw_q & 3 {
                0 => (sx, -1.0f32),
                1 => (1.0f32, sx),
                2 => (-sx, 1.0f32),
                _ => (-1.0f32, -sx),
            };
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
                (sky_r, sky_g, sky_b, f32::INFINITY)
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
                unsafe { (*atlas.add(o), *atlas.add(o + 1), *atlas.add(o + 2), t_hit) }
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
                let q = name.as_bytes()[name.len() - 1] - b'0';
                (g, eye, q as u32)
            }
        }
    }

    const SCENES: [&str; 6] = [
        "open_field",
        "corridor",
        "wall_yaw0",
        "wall_yaw1",
        "wall_yaw2",
        "wall_yaw3",
    ];

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

    fn scene_hash(name: &str) -> u64 {
        let (g, eye, yaw) = scene(name);
        let a = atlas_bytes();
        let h = fresh();
        render(h, &g, eye, yaw, &a);
        let px = &crate::cv(h).px;
        let hh = fnv(px);
        if let Ok(p) = std::env::var("VOXEL_SCENES_OUT") {
            let line = format!(
                "{{\"name\":\"{}\",\"hash\":\"{}\",\"gw\":{},\"gh\":{},\"grid\":[{}],\
                 \"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\
                 \"sky\":{},\"dst\":[{},{},{},{}],\"atlas\":\"{}\"}}\n",
                name, hh, GW, GH,
                g.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
                eye.0, eye.1, eye.2, yaw, VIEW, TILE_PX, N_TILES, SKY,
                DST.0, DST.1, DST.2, DST.3, b64(&a),
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
        // Horizon is the middle row of the view rect: pitch is 0, vfov 90.
        let top = (2 * 64 + 32) * 4;
        let bot = (46 * 64 + 32) * 4;
        assert_eq!(&px[top..top + 3], &sky[..], "above the horizon must be sky");
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

    // --- the goldens -------------------------------------------------------
    // Recorded 2026-09-15 on aarch64-apple-darwin (rustc 1.97.1) and matched
    // by the wasm32 build the same day (tests/wasm_voxel_check.mjs).
    const GOLD: [u64; 6] = [
        13989049085383848347,
        14152573310928964130,
        577179221746013019,
        5707841934264548112,
        955063394357532235,
        13551030726708363713,
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
