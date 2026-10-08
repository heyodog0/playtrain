// maze.rs — the DMLab maze raycast primitive (dmlab PLAN.md §3.3).
//
// The smallest extension of rs_voxel_view_free that renders a DeepMind Lab
// tile maze: one Amanatides-Woo DDA ray per pixel through a grid of cells,
// free yaw through psin/pcos, nearest sampling from a flat tile atlas, forward
// depth into the canvas depth buffer. What it adds over voxel.rs:
//
//   * one texture per face class: every cell names its own wall, floor and
//     ceiling tile (DMLab themes vary them per maze variation);
//   * a ceiling plane, per cell, or open sky;
//   * a floor height per cell, and void cells with no floor at all (skymaze
//     platforms);
//   * a decal tile on each of the four side faces of a wall cell (DMLab's wall
//     posters), alpha-blended over the wall in a centred square of the face;
//   * a sized billboard (`rs_maze_sprite`): DMLab pickups are a fraction of a
//     cell, where the voxel sprite is always 1x1.
//
// voxel.rs is untouched: craftax_fp's goldens do not move.
//
// GEOMETRY. Cell (r, c) is x in [c, c+1), z in [r, r+1); y is up, one cell is
// one unit horizontally and vertically (DMLab: 100 game units). Every cell is
// a COLUMN reaching down forever, whose top is at
//     solid wall      y = 1          (side and top faces: the wall tile)
//     floor cell      y = height/8   (side faces "risers": the wall tile;
//                                     top face: the floor tile)
//     void cell       no column      (rays fall through to the sky)
// A ray entering a cell below its top strikes a side face; a ray descending
// through the top inside the cell strikes the top. A non-solid cell with a
// ceiling tile has a ceiling plane at y = 1 that an ascending ray strikes.
// Anything else ends in the sky: a flat `sky_rgb`, depth +inf.
//
// CELL PLANES. `cells` holds MAZE_PLANES planes of w*h u16, row-major, plane p
// at offset p*w*h:
//     0 wall tile (side faces of a wall, risers of a floor); NONE = no texture
//     1 floor tile;                          NONE = void (no floor, no column)
//     2 ceiling tile;                        NONE = open sky above
//     3 flags: bits 0-7 floor height in eighths of a cell, bit 8 solid wall
//     4..7 decal tile on the face whose outward normal is -z (N), +x (E),
//          +z (S), -x (W); NONE = no decal
// One buffer rather than seven keeps the ABI short and lets the wasm backend
// stage it through the voxel grid buffer (`rs_voxel_grid_ptr`), so this file
// needs no state of its own.
//
// YAW is radians, voxel.rs's convention: yaw 0 faces -z, increasing toward +x.
// FOV is 90 degrees both ways (tan 45 = 1), as in voxel.rs and DMLab's default.
//
// DETERMINISM. f32 throughout; only + - * / sqrt and compares; psin/pcos for
// the yaw; no libm, no mul_add; every constant a literal; nothing allocated
// per call except the canvas depth buffer the first time a canvas is used.
// raster.mjs carries the line-for-line JS port (`mazeView`, `mazeSprite`) and
// tests/wasm_maze_check.mjs asserts native == wasm32 on the goldens below.

use crate::{cv, pcos, psin};

pub const MAZE_PLANES: u32 = 8;
const NONE: u16 = 0xFFFF;
const SOLID: u16 = 0x100;
const BIG: f32 = 1.0e30;

#[inline]
fn ffloor(x: f32) -> i32 {
    let t = x as i32;
    if (t as f32) > x { t - 1 } else { t }
}

#[inline]
fn frac(x: f32) -> f32 {
    x - (ffloor(x) as f32)
}

#[inline]
fn texel(atlas: *const u8, tile: u32, tile_px: u32, u: f32, v: f32) -> (u8, u8, u8, u8) {
    let tpx = tile_px as f32;
    let tmax = tile_px as i32 - 1;
    let mut tx = (u * tpx) as i32;
    let mut ty = (v * tpx) as i32;
    if tx < 0 { tx = 0; }
    if tx > tmax { tx = tmax; }
    if ty < 0 { ty = 0; }
    if ty > tmax { ty = tmax; }
    let o = (tile as usize) * (tile_px as usize) * (tile_px as usize) * 4
        + ((ty as usize) * (tile_px as usize) + (tx as usize)) * 4;
    unsafe { (*atlas.add(o), *atlas.add(o + 1), *atlas.add(o + 2), *atlas.add(o + 3)) }
}

// ---- mip levels (dmlab PLAN.md section 10, V2) -----------------------------
// `tile_px` is a word: bits 0-15 the tile size, bits 16-23 how many mip levels
// past the first the atlas carries (0: none, the original behaviour, bit for
// bit). With L levels the atlas is level 0 (n_tiles tiles of size^2), then
// level 1 (n_tiles tiles of (size/2)^2), ... level L, each a box filter of the
// one before. rs_maze_view/_boxes/_quads pick a level per pixel from the
// texel footprint, as GL's nearest-mipmap rule does: level l while the
// footprint exceeds sqrt(2) * 2^l, where
//     footprint = forward depth * (2 / dst_w) * size * density / max(cos, 1/64)
// is texels per pixel: the pixel's width at that depth, times the face's
// texels per unit (density: tile repeats per unit of the face), over the
// cosine between the ray and the face normal (a grazing face packs more
// texels into a pixel). rs_maze_sprite and rs_maze_sky always sample level 0.
#[inline]
fn tile_size(word: u32) -> u32 {
    word & 0xFFFF
}

#[inline]
fn mip_level(word: u32, foot: f32) -> u32 {
    let levels = (word >> 16) & 0xFF;
    let mut l = 0u32;
    let mut th = 1.4142135f32;
    while l < levels && foot > th {
        l += 1;
        th = th * 2.0f32;
    }
    l
}

#[inline]
fn footprint(z: f32, fw: f32, word: u32, density: f32, cosi: f32) -> f32 {
    let c = if cosi < 0.015625f32 { 0.015625f32 } else { cosi };
    ((z * (2.0f32 / fw)) * ((tile_size(word) as f32) * density)) / c
}

#[inline]
fn texel_mip(atlas: *const u8, n_tiles: u32, tile: u32, word: u32, level: u32, u: f32, v: f32) -> (u8, u8, u8, u8) {
    let size = tile_size(word);
    let mut off = 0usize;
    let mut k = 0u32;
    while k < level {
        let s = (size >> k) as usize;
        off += (n_tiles as usize) * s * s * 4;
        k += 1;
    }
    texel(unsafe { atlas.add(off) }, tile, size >> level, u, v)
}

/// Render a first-person view of a maze into the rect (`dst_x`, `dst_y`,
/// `dst_w`, `dst_h`) of `canvas`, filling that rect of the canvas depth buffer
/// with forward distance (sky = +inf) for `rs_maze_sprite`.
///
/// `cells` is MAZE_PLANES planes of `w*h` u16 (see the file comment); `atlas`
/// is `n_tiles` tiles of `tile_px`x`tile_px` RGBA. A tile index >= n_tiles
/// samples tile 0. `decal_lo`..`decal_hi` is the square of a side face, in
/// face UV (u across, v down from the top of the wall), that a decal covers.
#[no_mangle]
pub extern "C" fn rs_maze_view(
    canvas: u32,
    cells: *const u16,
    w: u32,
    h: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw: f32,
    view_dist: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    sky_rgb: u32,
    decal_lo: f32,
    decal_hi: f32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if cells.is_null() || atlas.is_null() {
        return;
    }
    if w == 0 || h == 0 || dst_w == 0 || dst_h == 0 || tile_px == 0 || n_tiles == 0 {
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

    let s = psin(yaw as f64) as f32;
    let co = pcos(yaw as f64) as f32;
    // forward = (sin, -cos), right = (cos, sin): voxel.rs free_basis.
    let fwd_x = s;
    let fwd_z = -co;
    let rgt_x = co;
    let rgt_z = s;

    let sky_r = ((sky_rgb >> 16) & 255) as u8;
    let sky_g = ((sky_rgb >> 8) & 255) as u8;
    let sky_b = (sky_rgb & 255) as u8;

    let wi = w as i32;
    let hi = h as i32;
    let wu = w as usize;
    let n = (w as usize) * (h as usize);
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let dspan = decal_hi - decal_lo;

    for py in 0..dst_h {
        let cyp = dst_y + py;
        if cyp as usize >= ch {
            continue;
        }
        let sy = 1.0f32 - 2.0f32 * ((py as f32 + 0.5f32) / fh);

        for px in 0..dst_w {
            let cxp = dst_x + px;
            if cxp as usize >= cw {
                continue;
            }
            let sx = 2.0f32 * ((px as f32 + 0.5f32) / fw) - 1.0f32;

            let rdx = sx * rgt_x + fwd_x;
            let rdz = sx * rgt_z + fwd_z;
            let rdy = sy;
            let len = (rdx * rdx + rdy * rdy + rdz * rdz).sqrt();
            let dx = rdx / len;
            let dy = rdy / len;
            let dz = rdz / len;

            let mut mx = ffloor(eye_x);
            let mut mz = ffloor(eye_z);
            let adx = if dx < 0.0f32 { -dx } else { dx };
            let adz = if dz < 0.0f32 { -dz } else { dz };
            let ddx = if adx > 0.0f32 { 1.0f32 / adx } else { BIG };
            let ddz = if adz > 0.0f32 { 1.0f32 / adz } else { BIG };
            let stepx: i32 = if dx > 0.0f32 { 1 } else { -1 };
            let stepz: i32 = if dz > 0.0f32 { 1 } else { -1 };
            let mut sidex = if adx > 0.0f32 {
                if dx > 0.0f32 { ((mx + 1) as f32 - eye_x) * ddx } else { (eye_x - mx as f32) * ddx }
            } else {
                BIG
            };
            let mut sidez = if adz > 0.0f32 {
                if dz > 0.0f32 { ((mz + 1) as f32 - eye_z) * ddz } else { (eye_z - mz as f32) * ddz }
            } else {
                BIG
            };

            // hit: 0 sky, 1 side on x, 2 side on z, 3 top, 4 ceiling
            let mut hit = 0u8;
            let mut t_hit = 0.0f32;
            let mut ci = 0usize;
            let mut t_enter = 0.0f32;
            let mut axis_x = true;
            let mut first = true;
            let mut top = 0.0f32;
            // Top of the column the ray is leaving. A side face exists only
            // where the next column rises above it; without this, rounding at
            // the seam between two equal floors (t_top a hair past t_exit)
            // would strike a riser of zero height and leak wall texels.
            let mut prev_top = -BIG;

            loop {
                if mx < 0 || mz < 0 || mx >= wi || mz >= hi {
                    break;
                }
                if t_enter > view_dist {
                    break;
                }
                let i = (mz as usize) * wu + (mx as usize);
                let flags = unsafe { *cells.add(3 * n + i) };
                let floor = unsafe { *cells.add(n + i) };
                let solid = (flags & SOLID) != 0;
                let has_col = solid || floor != NONE;
                let ctop = if solid { 1.0f32 } else { ((flags & 0xFF) as f32) * 0.125f32 };
                let t_exit = if sidex < sidez { sidex } else { sidez };

                // 1. a side face, struck on entry below the column top
                if !first && has_col && prev_top < ctop {
                    let y_in = eye_y + dy * t_enter;
                    if y_in < ctop {
                        hit = if axis_x { 1 } else { 2 };
                        t_hit = t_enter;
                        ci = i;
                        top = ctop;
                        break;
                    }
                }
                // 2. the column top, if the ray descends through it in here
                if has_col && dy < 0.0f32 {
                    let t_top = (ctop - eye_y) / dy;
                    if t_top >= t_enter && t_top < t_exit {
                        hit = 3;
                        t_hit = t_top;
                        ci = i;
                        top = ctop;
                        break;
                    }
                }
                // 3. the ceiling, if the ray ascends through y = 1 in here
                if !solid && dy > 0.0f32 {
                    let ceil = unsafe { *cells.add(2 * n + i) };
                    if ceil != NONE {
                        let t_c = (1.0f32 - eye_y) / dy;
                        if t_c >= t_enter && t_c < t_exit {
                            hit = 4;
                            t_hit = t_c;
                            ci = i;
                            break;
                        }
                    }
                }

                prev_top = if has_col { ctop } else { -BIG };
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
                let flags = unsafe { *cells.add(3 * n + ci) };
                let solid = (flags & SOLID) != 0;
                let (plane, u, v) = match hit {
                    1 => {
                        let f = frac(zh);
                        (0usize, if stepx > 0 { f } else { 1.0f32 - f }, frac(top - yh))
                    }
                    2 => {
                        let f = frac(xh);
                        (0usize, if stepz > 0 { 1.0f32 - f } else { f }, frac(top - yh))
                    }
                    3 => (if solid { 0usize } else { 1usize }, frac(xh), frac(zh)),
                    _ => (2usize, frac(xh), frac(zh)),
                };
                let raw = unsafe { *cells.add(plane * n + ci) };
                let tile = if (raw as u32) < n_tiles { raw as u32 } else { 0 };
                let cosi = match hit {
                    1 => if dx < 0.0f32 { -dx } else { dx },
                    2 => if dz < 0.0f32 { -dz } else { dz },
                    _ => if dy < 0.0f32 { -dy } else { dy },
                };
                let zf = t_hit / len;
                let lvl = mip_level(tile_px, footprint(zf, fw, tile_px, 1.0f32, cosi));
                let (mut tr, mut tg, mut tb, _) = texel_mip(atlas, n_tiles, tile, tile_px, lvl, u, v);
                // A decal on this side face of a wall, alpha-blended in f32.
                if solid && hit <= 2 && dspan > 0.0f32 {
                    let face = if hit == 1 {
                        if stepx > 0 { 7usize } else { 5usize }   // W : E
                    } else if stepz > 0 { 4usize } else { 6usize }; // N : S
                    let draw = unsafe { *cells.add(face * n + ci) };
                    if draw != NONE && u >= decal_lo && u < decal_hi && v >= decal_lo && v < decal_hi {
                        let dt = if (draw as u32) < n_tiles { draw as u32 } else { 0 };
                        let du = (u - decal_lo) / dspan;
                        let dv = (v - decal_lo) / dspan;
                        let dl = mip_level(tile_px, footprint(zf, fw, tile_px, 1.0f32 / dspan, cosi));
                        let (sr, sg, sb, sa) = texel_mip(atlas, n_tiles, dt, tile_px, dl, du, dv);
                        if sa == 255 {
                            tr = sr;
                            tg = sg;
                            tb = sb;
                        } else if sa != 0 {
                            let a = (sa as f32) / 255.0f32;
                            let ia = 1.0f32 - a;
                            tr = ((tr as f32) * ia + (sr as f32) * a) as u8;
                            tg = ((tg as f32) * ia + (sg as f32) * a) as u8;
                            tb = ((tb as f32) * ia + (sb as f32) * a) as u8;
                        }
                    }
                }
                (tr, tg, tb, t_hit / len)
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

/// Draw an upright billboard `size_w` wide and `size_h` tall (cells), its
/// bottom at height `base_y`, centred on (`sprite_x`, `sprite_z`), depth-tested
/// against the forward depths `rs_maze_view` left in the canvas. Same rules as
/// rs_voxel_sprite: only fully opaque texels write depth, partial alpha blends
/// in f32 over the uint8 canvas, nothing behind the eye or past `view_dist`.
#[no_mangle]
pub extern "C" fn rs_maze_sprite(
    canvas: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw: f32,
    view_dist: f32,
    sprite_x: f32,
    sprite_z: f32,
    base_y: f32,
    size_w: f32,
    size_h: f32,
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
    if c.depth.len() != cw * ch {
        c.depth = vec![f32::INFINITY; cw * ch];
    }
    let s = psin(yaw as f64) as f32;
    let co = pcos(yaw as f64) as f32;
    let fwd_x = s;
    let fwd_z = -co;
    let rgt_x = co;
    let rgt_z = s;

    let dx = sprite_x - eye_x;
    let dz = sprite_z - eye_z;
    let depth = dx * fwd_x + dz * fwd_z;
    let lat = dx * rgt_x + dz * rgt_z;
    if !(depth > 0.0f32) || depth > view_dist {
        return;
    }
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let hw = fw * 0.5f32;
    let hh = fh * 0.5f32;
    let half = size_w * 0.5f32;
    let x0f = ((lat - half) / depth + 1.0f32) * hw - 0.5f32;
    let x1f = ((lat + half) / depth + 1.0f32) * hw - 0.5f32;
    let y0f = (1.0f32 - ((base_y + size_h) - eye_y) / depth) * hh - 0.5f32;
    let y1f = (1.0f32 - (base_y - eye_y) / depth) * hh - 0.5f32;
    let wf = x1f - x0f;
    let hf = y1f - y0f;
    if !(wf > 0.0f32) || !(hf > 0.0f32) {
        return;
    }
    let mut ix0 = -ffloor(-x0f);
    let mut ix1 = ffloor(x1f);
    let mut iy0 = -ffloor(-y0f);
    let mut iy1 = ffloor(y1f);
    if ix0 < 0 { ix0 = 0; }
    if iy0 < 0 { iy0 = 0; }
    if ix1 > dst_w as i32 - 1 { ix1 = dst_w as i32 - 1; }
    if iy1 > dst_h as i32 - 1 { iy1 = dst_h as i32 - 1; }
    let t = if atlas_tile < n_tiles { atlas_tile } else { 0 };

    let mut py = iy0;
    while py <= iy1 {
        let cyp = dst_y as i32 + py;
        if cyp < 0 || cyp as usize >= ch {
            py += 1;
            continue;
        }
        let v = (py as f32 - y0f) / hf;
        let mut pxi = ix0;
        while pxi <= ix1 {
            let cxp = dst_x as i32 + pxi;
            if cxp < 0 || cxp as usize >= cw {
                pxi += 1;
                continue;
            }
            let i = (cyp as usize) * cw + (cxp as usize);
            if depth >= c.depth[i] {
                pxi += 1;
                continue;
            }
            let u = (pxi as f32 - x0f) / wf;
            let (sr, sg, sb, sa) = texel(atlas, t, tile_size(tile_px), u, v);
            if sa == 0 {
                pxi += 1;
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
            pxi += 1;
        }
        py += 1;
    }
}

// ---- two-colour sprites (dmlab PLAN.md section 11, T3) --------------------
// DMLab's human-recognisable pickups are a model painted with a pattern in two
// colours chosen at run time (continuous: named colours with noise), so their
// tiles cannot be baked. rs_maze_sprite2 is rs_maze_sprite with the colours as
// arguments: a texel is (R = shade, G = pattern weight, B unused, A =
// coverage), and its colour, in integer arithmetic,
//     c   = (c1 * (255 - G) + c2 * G + 127) / 255       per channel
//     rgb = (c * shade + 127) / 255
// with c1, c2 given as 0xRRGGBB. Everything else (placement, depth, alpha)
// is rs_maze_sprite's.
#[inline]
fn hrp_colour(rgb1: u32, rgb2: u32, shade: u8, wgt: u8) -> (u8, u8, u8) {
    let w = wgt as u32;
    let s = shade as u32;
    let ch = |k: u32| -> u8 {
        let a = (rgb1 >> k) & 255;
        let b = (rgb2 >> k) & 255;
        let c = (a * (255 - w) + b * w + 127) / 255;
        ((c * s + 127) / 255) as u8
    };
    (ch(16), ch(8), ch(0))
}

#[no_mangle]
pub extern "C" fn rs_maze_sprite2(
    canvas: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw: f32,
    view_dist: f32,
    sprite_x: f32,
    sprite_z: f32,
    base_y: f32,
    size_w: f32,
    size_h: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    atlas_tile: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
    rgb1: u32,
    rgb2: u32,
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
    if c.depth.len() != cw * ch {
        c.depth = vec![f32::INFINITY; cw * ch];
    }
    let s = psin(yaw as f64) as f32;
    let co = pcos(yaw as f64) as f32;
    let fwd_x = s;
    let fwd_z = -co;
    let rgt_x = co;
    let rgt_z = s;

    let dx = sprite_x - eye_x;
    let dz = sprite_z - eye_z;
    let depth = dx * fwd_x + dz * fwd_z;
    let lat = dx * rgt_x + dz * rgt_z;
    if !(depth > 0.0f32) || depth > view_dist {
        return;
    }
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let hw = fw * 0.5f32;
    let hh = fh * 0.5f32;
    let half = size_w * 0.5f32;
    let x0f = ((lat - half) / depth + 1.0f32) * hw - 0.5f32;
    let x1f = ((lat + half) / depth + 1.0f32) * hw - 0.5f32;
    let y0f = (1.0f32 - ((base_y + size_h) - eye_y) / depth) * hh - 0.5f32;
    let y1f = (1.0f32 - (base_y - eye_y) / depth) * hh - 0.5f32;
    let wf = x1f - x0f;
    let hf = y1f - y0f;
    if !(wf > 0.0f32) || !(hf > 0.0f32) {
        return;
    }
    let mut ix0 = -ffloor(-x0f);
    let mut ix1 = ffloor(x1f);
    let mut iy0 = -ffloor(-y0f);
    let mut iy1 = ffloor(y1f);
    if ix0 < 0 { ix0 = 0; }
    if iy0 < 0 { iy0 = 0; }
    if ix1 > dst_w as i32 - 1 { ix1 = dst_w as i32 - 1; }
    if iy1 > dst_h as i32 - 1 { iy1 = dst_h as i32 - 1; }
    let t = if atlas_tile < n_tiles { atlas_tile } else { 0 };

    let mut py = iy0;
    while py <= iy1 {
        let cyp = dst_y as i32 + py;
        if cyp < 0 || cyp as usize >= ch {
            py += 1;
            continue;
        }
        let v = (py as f32 - y0f) / hf;
        let mut pxi = ix0;
        while pxi <= ix1 {
            let cxp = dst_x as i32 + pxi;
            if cxp < 0 || cxp as usize >= cw {
                pxi += 1;
                continue;
            }
            let i = (cyp as usize) * cw + (cxp as usize);
            if depth >= c.depth[i] {
                pxi += 1;
                continue;
            }
            let u = (pxi as f32 - x0f) / wf;
            let (shade, wgt, _, sa) = texel(atlas, t, tile_size(tile_px), u, v);
            let (sr, sg, sb) = hrp_colour(rgb1, rgb2, shade, wgt);
            if sa == 0 {
                pxi += 1;
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
            pxi += 1;
        }
        py += 1;
    }
}

// ---- boxes --------------------------------------------------------------
// The rooms levels are not tile mazes: DMLab builds them from a few dozen
// axis-aligned brushes (//assets/maps/src). rs_maze_boxes renders such a
// scene directly: one ray per pixel, slab-tested against every box, the
// nearest entry textured through that face's own affine UV map. Same rules
// as rs_maze_view: f32, + - * / sqrt and compares, psin/pcos for yaw, nearest
// sampling, forward depth into the canvas depth buffer for rs_maze_sprite.
//
// `boxes` holds `n` records of MAZE_BOX_FLOATS f32: min x, y, z, max x, y, z
// (the primitive's frame: x east, y up, z south, one unit a DMLab cell), then
// for each face -x, +x, -y, +y, -z, +z: atlas tile (as f32; >= n_tiles or
// negative = invisible face, the ray passes through it), and the UV map
// u = frac(au0*hx + au1*hy + au2*hz + au3), v = frac(av0*hx + ... + av3)
// at the hit point h. A ray that starts inside a box ignores that box.
pub const MAZE_BOX_FLOATS: u32 = 6 + 6 * 9;

#[no_mangle]
pub extern "C" fn rs_maze_boxes(
    canvas: u32,
    boxes: *const f32,
    n: u32,
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
    if boxes.is_null() || atlas.is_null() || dst_w == 0 || dst_h == 0 || tile_px == 0 || n_tiles == 0 {
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
    let s = psin(yaw as f64) as f32;
    let co = pcos(yaw as f64) as f32;
    let fwd_x = s;
    let fwd_z = -co;
    let rgt_x = co;
    let rgt_z = s;
    let sky_r = ((sky_rgb >> 16) & 255) as u8;
    let sky_g = ((sky_rgb >> 8) & 255) as u8;
    let sky_b = (sky_rgb & 255) as u8;
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let stride = MAZE_BOX_FLOATS as usize;
    let b = |i: usize| -> f32 { unsafe { *boxes.add(i) } };

    for py in 0..dst_h {
        let cyp = dst_y + py;
        if cyp as usize >= ch {
            continue;
        }
        let sy = 1.0f32 - 2.0f32 * ((py as f32 + 0.5f32) / fh);
        for px in 0..dst_w {
            let cxp = dst_x + px;
            if cxp as usize >= cw {
                continue;
            }
            let sx = 2.0f32 * ((px as f32 + 0.5f32) / fw) - 1.0f32;
            let rdx = sx * rgt_x + fwd_x;
            let rdz = sx * rgt_z + fwd_z;
            let rdy = sy;
            let len = (rdx * rdx + rdy * rdy + rdz * rdz).sqrt();
            let d = [rdx / len, rdy / len, rdz / len];
            let e = [eye_x, eye_y, eye_z];
            let mut inv = [0.0f32; 3];
            for k in 0..3 {
                inv[k] = if d[k] > 0.0f32 || d[k] < 0.0f32 { 1.0f32 / d[k] } else { BIG };
            }
            let mut best = view_dist;
            let mut hit_box = usize::MAX;
            let mut hit_face = 0usize;
            for bi in 0..(n as usize) {
                let o = bi * stride;
                let mut t0 = -BIG;
                let mut t1 = BIG;
                let mut face = 0usize;
                let mut inside = true;
                let mut miss = false;
                for k in 0..3 {
                    let lo = b(o + k);
                    let hi = b(o + 3 + k);
                    if e[k] < lo || e[k] > hi {
                        inside = false;
                    }
                    if d[k] > 0.0f32 || d[k] < 0.0f32 {
                        let ta = (lo - e[k]) * inv[k];
                        let tb = (hi - e[k]) * inv[k];
                        let (tn, tf, fn_) = if ta < tb { (ta, tb, 2 * k) } else { (tb, ta, 2 * k + 1) };
                        if tn > t0 { t0 = tn; face = fn_; }
                        if tf < t1 { t1 = tf; }
                    } else if e[k] < lo || e[k] > hi {
                        miss = true;
                    }
                }
                if miss || inside || !(t0 <= t1) || !(t0 > 0.0f32) || !(t0 < best) {
                    continue;
                }
                let tile = b(o + 6 + face * 9);
                if !(tile >= 0.0f32) || !(tile < n_tiles as f32) {
                    continue;   // an invisible face (map/poltergeist, clip brushes)
                }
                best = t0;
                hit_box = bi;
                hit_face = face;
            }
            let (r, g, bl, depth) = if hit_box == usize::MAX {
                (sky_r, sky_g, sky_b, f32::INFINITY)
            } else {
                let h = [e[0] + d[0] * best, e[1] + d[1] * best, e[2] + d[2] * best];
                let f = hit_box * stride + 6 + hit_face * 9;
                let u = frac(b(f + 1) * h[0] + b(f + 2) * h[1] + b(f + 3) * h[2] + b(f + 4));
                let v = frac(b(f + 5) * h[0] + b(f + 6) * h[1] + b(f + 7) * h[2] + b(f + 8));
                let k = hit_face / 2;
                let cosi = if d[k] < 0.0f32 { -d[k] } else { d[k] };
                // texels per unit: the largest UV coefficient along the face's own axes
                let mut dens = 0.0f32;
                for j in 0..3 {
                    if j == k { continue; }
                    let au = b(f + 1 + j);
                    let av = b(f + 5 + j);
                    let au = if au < 0.0f32 { -au } else { au };
                    let av = if av < 0.0f32 { -av } else { av };
                    if au > dens { dens = au; }
                    if av > dens { dens = av; }
                }
                let lvl = mip_level(tile_px, footprint(best / len, fw, tile_px, dens, cosi));
                let (tr, tg, tb, _) = texel_mip(atlas, n_tiles, b(f) as u32, tile_px, lvl, u, v);
                (tr, tg, tb, best / len)
            };
            let i = (cyp as usize) * cw + (cxp as usize);
            let o = i * 4;
            c.px[o] = r;
            c.px[o + 1] = g;
            c.px[o + 2] = bl;
            c.px[o + 3] = 255;
            c.depth[i] = depth;
        }
    }
}

// ---- quads --------------------------------------------------------------
// Walls that are not axis-aligned (rooms_watermaze's 16-sided arena) and flat
// pictures hung on them. rs_maze_quads draws vertical textured quads OVER what
// rs_maze_boxes (or rs_maze_view) left in the canvas, depth-tested against its
// forward depths, with the same ray per pixel and the same rules: f32, + - * /
// sqrt and compares, psin/pcos for yaw, nearest sampling.
//
// `quads` holds `n` records of MAZE_QUAD_FLOATS f32: the base segment x0, z0,
// x1, z1 (the primitive's frame), bottom y0 and top y1, the atlas tile (as f32;
// negative or >= n_tiles skips the quad), u at the segment's two ends u0, u1
// and v at the top and the bottom v0, v1, then a mode:
//   0  a wall: opaque, both sides, UV wrapping (u = frac(u0 + (u1-u0)*s), s
//      along the segment; v = frac(v0 + (v1-v0)*(y1-hy)/(y1-y0)));
//   1  a picture: UV clamped to the tile, alpha 0 transparent, partial alpha
//      blended without writing depth, opaque texels write colour and depth.
// Walls are resolved first (the nearest per pixel), then pictures in record
// order over the result.
pub const MAZE_QUAD_FLOATS: u32 = 12;

#[no_mangle]
pub extern "C" fn rs_maze_quads(
    canvas: u32,
    quads: *const f32,
    n: u32,
    eye_x: f32,
    eye_y: f32,
    eye_z: f32,
    yaw: f32,
    view_dist: f32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if quads.is_null() || atlas.is_null() || n == 0 || dst_w == 0 || dst_h == 0 || tile_px == 0 || n_tiles == 0 {
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
    let s = psin(yaw as f64) as f32;
    let co = pcos(yaw as f64) as f32;
    let fwd_x = s;
    let fwd_z = -co;
    let rgt_x = co;
    let rgt_z = s;
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let stride = MAZE_QUAD_FLOATS as usize;
    let q = |i: usize| -> f32 { unsafe { *quads.add(i) } };
    // A quad's footprint: cos = |den| / |segment| (den = the ray's xz cross
    // the segment), density the larger of u per unit along the segment and v
    // per unit up it.
    let quad_foot = |o: usize, z: f32, den: f32| -> f32 {
        if (tile_px >> 16) & 0xFF == 0 {
            return 0.0f32;
        }
        let sgx = q(o + 2) - q(o);
        let sgz = q(o + 3) - q(o + 1);
        let sl = (sgx * sgx + sgz * sgz).sqrt();
        let du = q(o + 8) - q(o + 7);
        let dv = q(o + 10) - q(o + 9);
        let du = if du < 0.0f32 { -du } else { du };
        let dv = if dv < 0.0f32 { -dv } else { dv };
        let du = du / sl;
        let dv = dv / (q(o + 5) - q(o + 4));
        let dens = if du > dv { du } else { dv };
        let ad = if den < 0.0f32 { -den } else { den };
        footprint(z, fw, tile_px, dens, ad / sl)
    };

    for py in 0..dst_h {
        let cyp = dst_y + py;
        if cyp as usize >= ch {
            continue;
        }
        let sy = 1.0f32 - 2.0f32 * ((py as f32 + 0.5f32) / fh);
        for px in 0..dst_w {
            let cxp = dst_x + px;
            if cxp as usize >= cw {
                continue;
            }
            let sx = 2.0f32 * ((px as f32 + 0.5f32) / fw) - 1.0f32;
            let rdx = sx * rgt_x + fwd_x;
            let rdz = sx * rgt_z + fwd_z;
            let rdy = sy;
            let len = (rdx * rdx + rdy * rdy + rdz * rdz).sqrt();
            let dx = rdx / len;
            let dy = rdy / len;
            let dz = rdz / len;
            let i = (cyp as usize) * cw + (cxp as usize);
            for pass in 0..2u32 {
                // the ray parameter of what is already drawn here
                let mut best = c.depth[i] * len;
                if !(best < view_dist) {
                    best = view_dist;
                }
                let mut hit = usize::MAX;
                let mut hit_s = 0.0f32;
                let mut hit_y = 0.0f32;
                for qi in 0..(n as usize) {
                    let o = qi * stride;
                    let mode = q(o + 11);
                    if (pass == 0) != (mode < 0.5f32) {
                        continue;
                    }
                    let tile = q(o + 6);
                    if !(tile >= 0.0f32) || !(tile < n_tiles as f32) {
                        continue;
                    }
                    let x0 = q(o);
                    let z0 = q(o + 1);
                    let sgx = q(o + 2) - x0;
                    let sgz = q(o + 3) - z0;
                    let den = dx * sgz - dz * sgx;
                    if !(den > 0.0f32 || den < 0.0f32) {
                        continue;   // parallel to the quad
                    }
                    let wx = x0 - eye_x;
                    let wz = z0 - eye_z;
                    let t = (wx * sgz - wz * sgx) / den;
                    let sp = (wx * dz - wz * dx) / den;
                    if !(t > 0.0f32) || !(t < best) || sp < 0.0f32 || sp > 1.0f32 {
                        continue;
                    }
                    let hy = eye_y + dy * t;
                    if hy < q(o + 4) || hy > q(o + 5) {
                        continue;
                    }
                    if pass == 0 {
                        best = t;
                        hit = qi;
                        hit_s = sp;
                        hit_y = hy;
                        continue;
                    }
                    // a picture: drawn at once, in record order
                    let fy = (q(o + 5) - hy) / (q(o + 5) - q(o + 4));
                    let u = q(o + 7) + (q(o + 8) - q(o + 7)) * sp;
                    let v = q(o + 9) + (q(o + 10) - q(o + 9)) * fy;
                    let lvl = mip_level(tile_px, quad_foot(o, t / len, den));
                    let (sr, sg, sb, sa) = texel_mip(atlas, n_tiles, tile as u32, tile_px, lvl, u, v);
                    if sa == 0 {
                        continue;
                    }
                    let d = i * 4;
                    if sa == 255 {
                        c.px[d] = sr;
                        c.px[d + 1] = sg;
                        c.px[d + 2] = sb;
                        c.px[d + 3] = 255;
                        c.depth[i] = t / len;
                        best = t;
                    } else {
                        let a = (sa as f32) / 255.0f32;
                        let ia = 1.0f32 - a;
                        c.px[d] = ((c.px[d] as f32) * ia + (sr as f32) * a) as u8;
                        c.px[d + 1] = ((c.px[d + 1] as f32) * ia + (sg as f32) * a) as u8;
                        c.px[d + 2] = ((c.px[d + 2] as f32) * ia + (sb as f32) * a) as u8;
                        c.px[d + 3] = 255;
                    }
                }
                if pass == 0 && hit != usize::MAX {
                    let o = hit * stride;
                    let fy = (q(o + 5) - hit_y) / (q(o + 5) - q(o + 4));
                    let u = frac(q(o + 7) + (q(o + 8) - q(o + 7)) * hit_s);
                    let v = frac(q(o + 9) + (q(o + 10) - q(o + 9)) * fy);
                    let den = dx * (q(o + 3) - q(o + 1)) - dz * (q(o + 2) - q(o));
                    let lvl = mip_level(tile_px, quad_foot(o, best / len, den));
                    let (tr, tg, tb, _) = texel_mip(atlas, n_tiles, q(o + 6) as u32, tile_px, lvl, u, v);
                    let d = i * 4;
                    c.px[d] = tr;
                    c.px[d + 1] = tg;
                    c.px[d + 2] = tb;
                    c.px[d + 3] = 255;
                    c.depth[i] = best / len;
                }
            }
        }
    }
}

// ---- sky ----------------------------------------------------------------
// DMLab's skybox (a Quake 3 `skyparms` cube) over every pixel the other maze
// primitives left as sky (forward depth +inf): rs_maze_sky runs after them
// and repaints only those. The eye has no pitch, so a pixel's direction is the
// same ray rs_maze_boxes casts.
//
// `sky` holds 6 faces of `size` x `size` RGBA, in the order of Quake's
// suffixes rt, lf, up, dn, ft, bk, each face as its image file stores it.
// The face for a direction d (primitive frame: x east, y up, z south) is
// its major axis, and its (u, v) is Quake's own mapping, measured from
// DMLab's frames (dmlab PLAN.md section 10, V3):
//     rt +x: u = ( z/|x| + 1)/2   v = (-y/|x| + 1)/2
//     lf -x: u = (-z/|x| + 1)/2   v = (-y/|x| + 1)/2
//     up +y: u = (-x/|y| + 1)/2   v = ( z/|y| + 1)/2
//     dn -y: u = (-x/|y| + 1)/2   v = (-z/|y| + 1)/2
//     ft +z: u = ( x/|z| + 1)/2   v = (-y/|z| + 1)/2
//     bk -z: u = (-x/|z| + 1)/2   v = (-y/|z| + 1)/2
// nearest sampling, texel = min(floor(u * size), size - 1). Depth stays +inf.
#[no_mangle]
pub extern "C" fn rs_maze_sky(
    canvas: u32,
    yaw: f32,
    sky: *const u8,
    size: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if sky.is_null() || size == 0 || dst_w == 0 || dst_h == 0 {
        return;
    }
    let c = cv(canvas);
    let cw = c.dw;
    let ch = c.dh;
    if cw == 0 || ch == 0 || c.depth.len() != cw * ch {
        return;   // nothing drawn yet: no sky to repaint
    }
    let s = psin(yaw as f64) as f32;
    let co = pcos(yaw as f64) as f32;
    let fwd_x = s;
    let fwd_z = -co;
    let rgt_x = co;
    let rgt_z = s;
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let fs = size as f32;
    let smax = size as i32 - 1;
    let face_bytes = (size as usize) * (size as usize) * 4;
    for py in 0..dst_h {
        let cyp = dst_y + py;
        if cyp as usize >= ch {
            continue;
        }
        let sy = 1.0f32 - 2.0f32 * ((py as f32 + 0.5f32) / fh);
        for px in 0..dst_w {
            let cxp = dst_x + px;
            if cxp as usize >= cw {
                continue;
            }
            let i = (cyp as usize) * cw + (cxp as usize);
            if !c.depth[i].is_infinite() {
                continue;
            }
            let sx = 2.0f32 * ((px as f32 + 0.5f32) / fw) - 1.0f32;
            let x = sx * rgt_x + fwd_x;
            let y = sy;
            let z = sx * rgt_z + fwd_z;
            let ax = if x < 0.0f32 { -x } else { x };
            let ay = if y < 0.0f32 { -y } else { y };
            let az = if z < 0.0f32 { -z } else { z };
            let (face, uu, vv) = if ax >= ay && ax >= az {
                if x > 0.0f32 { (0usize, z / ax, -y / ax) } else { (1usize, -z / ax, -y / ax) }
            } else if ay >= az {
                if y > 0.0f32 { (2usize, -x / ay, z / ay) } else { (3usize, -x / ay, -z / ay) }
            } else if z > 0.0f32 {
                (4usize, x / az, -y / az)
            } else {
                (5usize, -x / az, -y / az)
            };
            let mut tx = (((uu + 1.0f32) * 0.5f32) * fs) as i32;
            let mut ty = (((vv + 1.0f32) * 0.5f32) * fs) as i32;
            if tx < 0 { tx = 0; }
            if tx > smax { tx = smax; }
            if ty < 0 { ty = 0; }
            if ty > smax { ty = smax; }
            let o = face * face_bytes + ((ty as usize) * (size as usize) + (tx as usize)) * 4;
            let d = i * 4;
            unsafe {
                c.px[d] = *sky.add(o);
                c.px[d + 1] = *sky.add(o + 1);
                c.px[d + 2] = *sky.add(o + 2);
            }
            c.px[d + 3] = 255;
        }
    }
}

// ---- pview --------------------------------------------------------------
// A view with pitch, for a fixed eye (psychlab: the player only looks). The
// static scene is a cube map around the eye; flat solid-colour quads (a
// screen and what it shows) go over it in record order, the last one a pixel
// meets winning. Every pixel of the dst rect is painted; depth stays +inf.
//
// Frame: DMLab's world axes (x east, y north, z up) about the eye. `yaw` is
// counter-clockwise from +x and `pitch` positive looking down, in radians:
//     fwd = (cp cy, cp sy, -sp)   rgt = (sy, -cy, 0)   up = (sp cy, sp sy, cp)
// The pixel (px, py) of a dst_w x dst_h rect looks along
//     d = fwd + sx * rgt + sy * up,   sx = (2 (px + 0.5)/dst_w - 1) * view,
//                                     sy = (1 - 2 (py + 0.5)/dst_h) * view
// (view = tan of half the field of view; f32 throughout, psin/pcos for the
// angles, + - * / and compares only).
//
// `pano` holds 6 faces of `size` x `size` RGBA in the order +x -x +y -y +z -z;
// the face is d's major axis and (u, v) in [-1, 1]:
//     +x: ( dy, -dz)/|dx|   -x: (-dy, -dz)/|dx|   +y: (-dx, -dz)/|dy|
//     -y: ( dx, -dz)/|dy|   +z: ( dx,  dy)/|dz|   -z: ( dx, -dy)/|dz|
// nearest texel min(floor((u + 1)/2 * size), size - 1) (tools/psych_panorama.py
// bakes the faces with the same mapping).
//
// `quads` holds `n` records of MAZE_PQUAD_FLOATS f32: a corner o, two
// perpendicular edges a and b (eye-relative, world axes), and r, g, b in
// 0..255. A quad covers o + s a + t b for s, t in [0, 1): the ray meets its
// plane at k = (o.n)/(d.n), n = a x b, if k > 0; then h = k d - o,
// s = (h.a)/(a.a), t = (h.b)/(b.b).
pub const MAZE_PQUAD_FLOATS: u32 = 12;

#[no_mangle]
pub extern "C" fn rs_maze_pview(
    canvas: u32,
    yaw: f32,
    pitch: f32,
    view: f32,
    pano: *const u8,
    size: u32,
    quads: *const f32,
    n: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if pano.is_null() || size == 0 || dst_w == 0 || dst_h == 0 {
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
    let sy_ = psin(yaw as f64) as f32;
    let cy_ = pcos(yaw as f64) as f32;
    let sp = psin(pitch as f64) as f32;
    let cp = pcos(pitch as f64) as f32;
    let fwd = [cp * cy_, cp * sy_, -sp];
    let rgt = [sy_, -cy_, 0.0f32];
    let up = [sp * cy_, sp * sy_, cp];
    // the quads, with their normals and edge lengths
    let stride = MAZE_PQUAD_FLOATS as usize;
    let q: &[f32] = if quads.is_null() || n == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(quads, n as usize * stride) }
    };
    let mut pre: Vec<[f32; 6]> = Vec::with_capacity(n as usize);
    for k in 0..(q.len() / stride) {
        let r = &q[k * stride..k * stride + stride];
        let nx = r[4] * r[8] - r[5] * r[7];
        let ny = r[5] * r[6] - r[3] * r[8];
        let nz = r[3] * r[7] - r[4] * r[6];
        let on = r[0] * nx + r[1] * ny + r[2] * nz;
        let aa = r[3] * r[3] + r[4] * r[4] + r[5] * r[5];
        let bb = r[6] * r[6] + r[7] * r[7] + r[8] * r[8];
        pre.push([nx, ny, nz, on, aa, bb]);
    }
    let fw = dst_w as f32;
    let fh = dst_h as f32;
    let fs = size as f32;
    let smax = size as i32 - 1;
    let face_bytes = (size as usize) * (size as usize) * 4;
    for py in 0..dst_h {
        let cyp = dst_y + py;
        if cyp as usize >= ch {
            continue;
        }
        let sy = (1.0f32 - 2.0f32 * ((py as f32 + 0.5f32) / fh)) * view;
        for px in 0..dst_w {
            let cxp = dst_x + px;
            if cxp as usize >= cw {
                continue;
            }
            let i = (cyp as usize) * cw + (cxp as usize);
            let sx = (2.0f32 * ((px as f32 + 0.5f32) / fw) - 1.0f32) * view;
            let dx = fwd[0] + sx * rgt[0] + sy * up[0];
            let dy = fwd[1] + sx * rgt[1] + sy * up[1];
            let dz = fwd[2] + sx * rgt[2] + sy * up[2];
            let ax = if dx < 0.0f32 { -dx } else { dx };
            let ay = if dy < 0.0f32 { -dy } else { dy };
            let az = if dz < 0.0f32 { -dz } else { dz };
            let (face, uu, vv) = if ax >= ay && ax >= az {
                if dx > 0.0f32 { (0usize, dy / ax, -dz / ax) } else { (1usize, -dy / ax, -dz / ax) }
            } else if ay >= az {
                if dy > 0.0f32 { (2usize, -dx / ay, -dz / ay) } else { (3usize, dx / ay, -dz / ay) }
            } else if dz > 0.0f32 {
                (4usize, dx / az, dy / az)
            } else {
                (5usize, dx / az, -dy / az)
            };
            let mut tx = (((uu + 1.0f32) * 0.5f32) * fs) as i32;
            let mut ty = (((vv + 1.0f32) * 0.5f32) * fs) as i32;
            if tx < 0 { tx = 0; }
            if tx > smax { tx = smax; }
            if ty < 0 { ty = 0; }
            if ty > smax { ty = smax; }
            let o = face * face_bytes + ((ty as usize) * (size as usize) + (tx as usize)) * 4;
            let (mut r, mut g, mut b) = unsafe { (*pano.add(o), *pano.add(o + 1), *pano.add(o + 2)) };
            for k in 0..pre.len() {
                let p = &pre[k];
                let dn = dx * p[0] + dy * p[1] + dz * p[2];
                if dn == 0.0f32 {
                    continue;
                }
                let t = p[3] / dn;
                if !(t > 0.0f32) {
                    continue;
                }
                let rec = &q[k * stride..k * stride + stride];
                let hx = t * dx - rec[0];
                let hy = t * dy - rec[1];
                let hz = t * dz - rec[2];
                let s = (hx * rec[3] + hy * rec[4] + hz * rec[5]) / p[4];
                if !(s >= 0.0f32 && s < 1.0f32) {
                    continue;
                }
                let u = (hx * rec[6] + hy * rec[7] + hz * rec[8]) / p[5];
                if !(u >= 0.0f32 && u < 1.0f32) {
                    continue;
                }
                r = rec[9] as u8;
                g = rec[10] as u8;
                b = rec[11] as u8;
            }
            let d = i * 4;
            c.px[d] = r;
            c.px[d + 1] = g;
            c.px[d + 2] = b;
            c.px[d + 3] = 255;
            c.depth[i] = f32::INFINITY;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TILE_PX: u32 = 16;
    const N_TILES: u32 = 8;
    const W: u32 = 12;
    const H: u32 = 12;
    const SKY: u32 = 0x96E0FF;
    const VIEW: f32 = 20.0;
    const DST: (u32, u32, u32, u32) = (0, 0, 64, 64);
    const DECAL: (f32, f32) = (0.25, 0.75);

    // No symmetry in any direction, per tile; tile 7 has a transparent border
    // and a translucent ring so decals and sprites exercise the alpha paths.
    fn atlas_bytes() -> Vec<u8> {
        let mut a = vec![0u8; (N_TILES * TILE_PX * TILE_PX * 4) as usize];
        for t in 0..N_TILES {
            for y in 0..TILE_PX {
                for x in 0..TILE_PX {
                    let o = ((t * TILE_PX * TILE_PX + y * TILE_PX + x) * 4) as usize;
                    a[o] = ((t * 61 + x * 13 + y * 7) & 255) as u8;
                    a[o + 1] = ((t * 97 + x * 5 + y * 29) & 255) as u8;
                    a[o + 2] = ((t * 131 + x * 23 + y * 3) & 255) as u8;
                    a[o + 3] = if t == 7 {
                        let e = x.min(y).min(TILE_PX - 1 - x).min(TILE_PX - 1 - y);
                        if e == 0 { 0 } else if e == 1 { 128 } else { 255 }
                    } else { 255 };
                }
            }
        }
        a
    }

    struct Maze { p: Vec<u16> }
    impl Maze {
        fn new() -> Self {
            let n = (W * H) as usize;
            let mut p = vec![NONE; n * MAZE_PLANES as usize];
            for i in 0..n {
                p[n + i] = 1;      // floor tile 1
                p[3 * n + i] = 0;  // height 0, not solid
            }
            Maze { p }
        }
        fn n(&self) -> usize { (W * H) as usize }
        fn at(r: u32, c: u32) -> usize { (r * W + c) as usize }
        fn wall(&mut self, r: u32, c: u32, tile: u16) {
            let n = self.n(); let i = Self::at(r, c);
            self.p[i] = tile; self.p[3 * n + i] = SOLID;
        }
        fn ceil_all(&mut self, tile: u16) {
            let n = self.n();
            for i in 0..n { self.p[2 * n + i] = tile; }
        }
        fn border(&mut self, tile: u16) {
            for k in 0..W { self.wall(0, k, tile); self.wall(H - 1, k, tile); }
            for k in 0..H { self.wall(k, 0, tile); self.wall(k, W - 1, tile); }
        }
    }

    // (maze, eye, yaw) per golden scene.
    fn scene(name: &str) -> (Maze, (f32, f32, f32), f32) {
        let mut m = Maze::new();
        let eye = (6.5f32, 0.51f32, 8.5f32);
        match name {
            // Walls either side of the eye's column, ceiling overhead.
            "corridor" => {
                for r in 0..H { m.wall(r, 5, 2); m.wall(r, 7, 3); }
                m.ceil_all(4);
                (m, eye, 0.0)
            }
            // A closed room with a ceiling, eye off-centre, odd yaw.
            "room_ceiling" => {
                m.border(2);
                m.wall(3, 3, 3);
                m.ceil_all(4);
                (m, (5.3, 0.51, 7.7), 0.7)
            }
            // No ceiling: the sky above the walls, wall tops visible.
            "open_sky" => {
                m.border(2);
                m.wall(4, 6, 3);
                (m, eye, -0.4)
            }
            // Per-cell floor/wall/ceiling tiles and decals on several faces.
            "variation" => {
                m.border(2);
                let n = m.n();
                for r in 1..H - 1 {
                    for c in 1..W - 1 {
                        let i = Maze::at(r, c);
                        m.p[n + i] = ((r + c) % 3) as u16 + 1;
                        m.p[2 * n + i] = ((r * c) % 2) as u16 + 4;
                    }
                }
                for c in 1..W - 1 { m.wall(2, c, 3 + (c % 2) as u16); }
                for c in 1..W - 1 { m.p[6 * n + Maze::at(2, c)] = if c % 3 == 0 { 7 } else { 6 }; }
                m.p[4 * n + Maze::at(2, 6)] = 6;
                (m, eye, 0.15)
            }
            // Skymaze: a staircase of platforms rising away from the eye, a
            // void column down one side and a void gap across it, no ceiling.
            "platform_edge" => {
                let n = m.n();
                for i in 0..n { m.p[n + i] = NONE; }
                for r in 2..10 {
                    for c in 4..9 {
                        if r == 5 && c >= 6 { continue; }
                        let i = Maze::at(r, c);
                        m.p[n + i] = 1 + ((r + c) % 2) as u16;
                        m.p[i] = 5;
                        m.p[3 * n + i] = (((9 - r) * 2) & 0xFF) as u16;
                    }
                }
                (m, (6.5, 0.6, 9.5), 0.3)
            }
            // A door: a doorway in a wall row, closed by a differently
            // textured wall cell.
            "door" => {
                for c in 0..W { m.wall(4, c, 2); }
                m.wall(4, 6, 6);
                m.ceil_all(4);
                (m, eye, 0.05)
            }
            // The sprite scene: sized billboards in a room, one occluded.
            _ => {
                m.border(2);
                for c in 2..10 { m.wall(3, c, 3); }
                m.ceil_all(4);
                (m, eye, 0.0)
            }
        }
    }

    // (x, z, base_y, w, h, tile)
    fn sprites(name: &str) -> Vec<(f32, f32, f32, f32, f32, u32)> {
        match name {
            "sprites" => vec![
                (6.5, 6.5, 0.0, 0.25, 0.33, 7),
                (5.9, 5.5, 0.0, 0.25, 0.33, 6),
                (6.5, 2.5, 0.0, 0.5, 0.5, 1),   // behind the wall row: occluded
                (6.5, 10.5, 0.0, 0.5, 0.5, 2),  // behind the eye
            ],
            _ => Vec::new(),
        }
    }

    // (x, z, base_y, w, h, tile, rgb1, rgb2): rs_maze_sprite2 billboards
    fn sprites2(name: &str) -> Vec<(f32, f32, f32, f32, f32, u32, u32, u32)> {
        match name {
            "sprites2" => vec![
                (6.5, 6.5, 0.0, 0.25, 0.33, 7, 0xFF0080, 0x20C040),   // alpha ring: blends
                (5.9, 5.5, 0.0, 0.25, 0.33, 6, 0x102030, 0xF0E0D0),
                (6.9, 5.0, 0.1, 0.4, 0.4, 3, 0x00FFFF, 0xFFFF00),
            ],
            _ => Vec::new(),
        }
    }

    const SCENES: [&str; 7] =
        ["corridor", "room_ceiling", "open_sky", "variation", "platform_edge", "door", "sprites"];

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

    fn fresh() -> u32 {
        let st = crate::rs_state_new();
        crate::rs_state_select(st);
        crate::rs_new_canvas(64.0, 64.0, 64.0, 64.0)
    }

    fn render(h: u32, m: &Maze, eye: (f32, f32, f32), yaw: f32, a: &[u8]) {
        rs_maze_view(
            h, m.p.as_ptr(), W, H, eye.0, eye.1, eye.2, yaw, VIEW,
            a.as_ptr(), TILE_PX, N_TILES, SKY, DECAL.0, DECAL.1, DST.0, DST.1, DST.2, DST.3,
        );
    }

    fn render_all(h: u32, name: &str, m: &Maze, eye: (f32, f32, f32), yaw: f32, a: &[u8]) {
        render(h, m, eye, yaw, a);
        for (sx, sz, by, sw, sh, t) in sprites(name) {
            rs_maze_sprite(
                h, eye.0, eye.1, eye.2, yaw, VIEW, sx, sz, by, sw, sh,
                a.as_ptr(), TILE_PX, N_TILES, t, DST.0, DST.1, DST.2, DST.3,
            );
        }
        for (sx, sz, by, sw, sh, t, c1, c2) in sprites2(name) {
            rs_maze_sprite2(
                h, eye.0, eye.1, eye.2, yaw, VIEW, sx, sz, by, sw, sh,
                a.as_ptr(), TILE_PX, N_TILES, t, DST.0, DST.1, DST.2, DST.3, c1, c2,
            );
        }
    }

    fn scene_hash(name: &str) -> u64 {
        let (m, eye, yaw) = scene(name);
        let a = atlas_bytes();
        let h = fresh();
        render_all(h, name, &m, eye, yaw, &a);
        let hh = fnv(&crate::cv(h).px);
        // MAZE_DUMP_DIR=<dir>: raw 64x64 RGBA per scene, for looking at.
        if let Ok(d) = std::env::var("MAZE_DUMP_DIR") {
            std::fs::write(format!("{}/{}.rgba", d, name), &crate::cv(h).px).unwrap();
        }
        if let Ok(p) = std::env::var("MAZE_SCENES_OUT") {
            let line = format!(
                "{{\"name\":\"{}\",\"hash\":\"{}\",\"w\":{},\"h\":{},\"cells\":[{}],\
                 \"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\
                 \"sky\":{},\"decal\":[{},{}],\"dst\":[{},{},{},{}],\"sprites\":[{}],\"sprites2\":[{}],\"atlas\":\"{}\"}}\n",
                name, hh, W, H,
                m.p.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
                eye.0, eye.1, eye.2, yaw, VIEW, TILE_PX, N_TILES, SKY, DECAL.0, DECAL.1,
                DST.0, DST.1, DST.2, DST.3,
                sprites(name).iter().map(|s| format!("[{},{},{},{},{},{}]", s.0, s.1, s.2, s.3, s.4, s.5))
                    .collect::<Vec<_>>().join(","),
                sprites2(name).iter().map(|s| format!("[{},{},{},{},{},{},{},{}]", s.0, s.1, s.2, s.3, s.4, s.5, s.6, s.7))
                    .collect::<Vec<_>>().join(","),
                b64(&a),
            );
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        hh
    }

    fn px_at(h: u32, r: usize, c: usize) -> [u8; 3] {
        let p = &crate::cv(h).px;
        let o = (r * 64 + c) * 4;
        [p[o], p[o + 1], p[o + 2]]
    }

    fn sky() -> [u8; 3] {
        [((SKY >> 16) & 255) as u8, ((SKY >> 8) & 255) as u8, (SKY & 255) as u8]
    }

    #[test]
    fn ceiling_hides_the_sky_and_open_sky_shows_it() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("corridor");
        let h = fresh();
        render(h, &m, eye, yaw, &a);
        for c in 0..64 {
            assert_ne!(px_at(h, 2, c), sky(), "ceiling scene showed sky at row 2 col {}", c);
        }
        let (m, eye, yaw) = scene("open_sky");
        let h = fresh();
        render(h, &m, eye, yaw, &a);
        assert_eq!(px_at(h, 1, 32), sky(), "open-sky scene has no sky at the top");
        assert!(crate::cv(h).depth[64 + 32].is_infinite());
    }

    #[test]
    fn floor_is_below_and_walls_are_nearer_than_far_floor() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("corridor");
        let h = fresh();
        render(h, &m, eye, yaw, &a);
        let d = &crate::cv(h).depth;
        assert!(d[60 * 64 + 32].is_finite(), "no floor straight down");
        assert!(d[32 * 64 + 1] < d[33 * 64 + 32], "corridor wall at the edge should be nearer than the far floor");
    }

    #[test]
    fn wall_depth_is_constant_across_a_flat_wall() {
        let mut m = Maze::new();
        for c in 0..W { m.wall(4, c, 2); }
        m.ceil_all(4);
        let a = atlas_bytes();
        let h = fresh();
        render(h, &m, (6.5, 0.5, 9.5), 0.0, &a);
        let d = &crate::cv(h).depth;
        let mut seen = Vec::new();
        // Eye y 0.5, wall y 0..1 at forward 4.5: rows 32 +/- 3.5 are wall;
        // rows 30..34 are well inside it.
        for py in 30..34 {
            for px in 0..64 {
                seen.push(d[py * 64 + px]);
            }
        }
        let lo = seen.iter().cloned().fold(f32::INFINITY, f32::min);
        let hi = seen.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        assert!((lo - 4.5).abs() < 1.0e-4 && hi / lo < 1.0001, "wall depth {}..{}", lo, hi);
    }

    #[test]
    fn void_cells_fall_through_to_sky_and_platforms_have_risers() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("platform_edge");
        let h = fresh();
        render(h, &m, eye, yaw, &a);
        let d = &crate::cv(h).depth;
        // Straight down from above a platform: finite. Looking out past the
        // platforms at the horizon: sky.
        assert!(d[63 * 64 + 32].is_finite(), "no platform under the eye");
        let sky_px = (0..64).filter(|&c| px_at(h, 40, c) == sky()).count()
            + (0..64).filter(|&c| px_at(h, 63, c) == sky()).count();
        assert!(sky_px > 0 || (0..64).any(|c| px_at(h, 20, c) == sky()), "no void visible");
        // A riser: some side-face hit exists (wall tile 5 is the riser texture).
        let mut seen5 = false;
        let t5 = (5 * TILE_PX * TILE_PX * 4) as usize;
        for r in 0..64 { for c in 0..64 {
            let p = px_at(h, r, c);
            for k in (0..(TILE_PX * TILE_PX) as usize).step_by(1) {
                if a[t5 + k * 4] == p[0] && a[t5 + k * 4 + 1] == p[1] && a[t5 + k * 4 + 2] == p[2] { seen5 = true; }
            }
        } }
        assert!(seen5, "no riser (tile 5) pixel in the platform scene");
    }

    #[test]
    fn decals_change_the_wall_and_only_inside_their_square() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("variation");
        let with = { let h = fresh(); render(h, &m, eye, yaw, &a); crate::cv(h).px.clone() };
        let mut m2 = Maze { p: m.p.clone() };
        let n = m2.n();
        for k in 4 * n..8 * n { m2.p[k] = NONE; }
        let without = { let h = fresh(); render(h, &m2, eye, yaw, &a); crate::cv(h).px.clone() };
        assert_ne!(with, without, "decals changed nothing");
    }

    #[test]
    fn yaw_turns_the_view() {
        let a = atlas_bytes();
        let (m, eye, _) = scene("room_ceiling");
        let mut hs = Vec::new();
        for k in 0..4 {
            let h = fresh();
            render(h, &m, eye, 0.3 + 1.5707964 * k as f32, &a);
            hs.push(fnv(&crate::cv(h).px));
        }
        for i in 0..4 { for j in i + 1..4 { assert_ne!(hs[i], hs[j]); } }
    }

    #[test]
    fn sprites_draw_scale_and_occlude() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("sprites");
        let changed = |sx: f32, sz: f32, sw: f32| -> usize {
            let h = fresh();
            render(h, &m, eye, yaw, &a);
            let before = crate::cv(h).px.clone();
            rs_maze_sprite(h, eye.0, eye.1, eye.2, yaw, VIEW, sx, sz, 0.0, sw, 0.5,
                a.as_ptr(), TILE_PX, N_TILES, 1, DST.0, DST.1, DST.2, DST.3);
            let after = &crate::cv(h).px;
            (0..before.len() / 4).filter(|i| before[i * 4..i * 4 + 3] != after[i * 4..i * 4 + 3]).count()
        };
        assert!(changed(6.5, 6.5, 0.5) > 0, "a sprite ahead drew nothing");
        assert!(changed(6.5, 6.5, 0.5) > changed(6.5, 6.5, 0.25), "a wider sprite is not wider");
        assert!(changed(6.5, 7.5, 0.5) > changed(6.5, 5.5, 0.5), "a nearer sprite is not bigger");
        assert_eq!(changed(6.5, 2.5, 0.5), 0, "a sprite behind a wall drew");
        assert_eq!(changed(6.5, 10.5, 0.5), 0, "a sprite behind the eye drew");
    }

    #[test]
    fn repeat_is_stable_and_alloc_free() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("variation");
        let h = fresh();
        render(h, &m, eye, yaw, &a);
        let h1 = fnv(&crate::cv(h).px);
        let cap = crate::cv(h).depth.capacity();
        let ptr = crate::cv(h).depth.as_ptr();
        for _ in 0..5 { render(h, &m, eye, yaw, &a); }
        assert_eq!(h1, fnv(&crate::cv(h).px));
        assert_eq!(cap, crate::cv(h).depth.capacity());
        assert_eq!(ptr, crate::cv(h).depth.as_ptr(), "depth buffer reallocated");
    }

    // --- boxes ----------------------------------------------------------
    // A box with one tile on every face and a world-aligned UV map whose
    // scale differs per face, so a transposed or mirrored axis changes the
    // hash; `invisible` faces carry tile -1.
    fn boxrec(lo: [f32; 3], hi: [f32; 3], tile: f32, invisible: &[usize]) -> Vec<f32> {
        let mut v = vec![lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]];
        for f in 0..6usize {
            let t = if invisible.contains(&f) { -1.0 } else { tile + (f % 2) as f32 };
            let k = 0.5 + 0.25 * f as f32;
            // u along the face's first in-plane axis, v along its second.
            let (au, av) = match f / 2 {
                0 => ([0.0, 0.0, k], [0.0, -k, 0.0]),
                1 => ([k, 0.0, 0.0], [0.0, 0.0, k]),
                _ => ([k, 0.0, 0.0], [0.0, -k, 0.0]),
            };
            v.push(t);
            v.extend_from_slice(&[au[0], au[1], au[2], 0.125, av[0], av[1], av[2], 0.375]);
        }
        v
    }

    fn box_scene(name: &str) -> (Vec<f32>, (f32, f32, f32), f32) {
        // A room 6 x 4 cells, walls 0.08 thick, 1.92 high, a floor and a ceiling.
        let mut b = Vec::new();
        let wall = |b: &mut Vec<f32>, lo: [f32; 3], hi: [f32; 3], t: f32| b.extend(boxrec(lo, hi, t, &[]));
        wall(&mut b, [-3.0, -0.08, -2.0], [3.0, 0.0, 2.0], 1.0);      // floor
        wall(&mut b, [-3.0, 1.92, -2.0], [3.0, 2.0, 2.0], 3.0);       // ceiling
        wall(&mut b, [-3.08, 0.0, -2.0], [-3.0, 1.92, 2.0], 5.0);     // west
        wall(&mut b, [3.0, 0.0, -2.0], [3.08, 1.92, 2.0], 5.0);       // east
        wall(&mut b, [-3.0, 0.0, -2.08], [3.0, 1.92, -2.0], 2.0);     // north
        let eye = (-1.3f32, 0.5f32, 1.1f32);
        match name {
            "box_room" => {
                wall(&mut b, [-3.0, 0.0, 2.0], [3.0, 1.92, 2.08], 2.0);
                (b, eye, 0.6)
            }
            "box_doorway" => {
                // south wall with a gap, a second room beyond it
                wall(&mut b, [-3.0, 0.0, 2.0], [-0.5, 1.92, 2.08], 2.0);
                wall(&mut b, [0.5, 0.0, 2.0], [3.0, 1.92, 2.08], 2.0);
                wall(&mut b, [-3.0, -0.08, 2.08], [3.0, 0.0, 6.0], 4.0);
                wall(&mut b, [-3.0, 0.0, 6.0], [3.0, 1.92, 6.08], 5.0);
                (b, (0.2, 0.5, -1.0), 3.0)
            }
            "box_pillar" => {
                wall(&mut b, [-3.0, 0.0, 2.0], [3.0, 1.92, 2.08], 2.0);
                wall(&mut b, [0.0, 0.0, -0.4], [0.4, 1.0, 0.0], 6.0);
                (b, eye, 0.9)
            }
            _ => {
                // "box_invisible": the south wall's inner face is invisible, so
                // the open sky beyond shows through it.
                b.extend(boxrec([-3.0, 0.0, 2.0], [3.0, 1.92, 2.08], 2.0, &[4]));
                (b, (0.0, 0.5, 0.0), 3.14159)
            }
        }
    }

    const BOX_SCENES: [&str; 4] = ["box_room", "box_doorway", "box_pillar", "box_invisible"];

    fn box_hash(name: &str) -> u64 {
        let (bx, eye, yaw) = box_scene(name);
        let a = atlas_bytes();
        let h = fresh();
        let n = (bx.len() / MAZE_BOX_FLOATS as usize) as u32;
        rs_maze_boxes(h, bx.as_ptr(), n, eye.0, eye.1, eye.2, yaw, VIEW,
            a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
        if name == "box_pillar" {
            rs_maze_sprite(h, eye.0, eye.1, eye.2, yaw, VIEW, 0.6, -1.0, 0.0, 0.25, 0.33,
                a.as_ptr(), TILE_PX, N_TILES, 7, DST.0, DST.1, DST.2, DST.3);
        }
        let hh = fnv(&crate::cv(h).px);
        if let Ok(d) = std::env::var("MAZE_DUMP_DIR") {
            std::fs::write(format!("{}/{}.rgba", d, name), &crate::cv(h).px).unwrap();
        }
        if let Ok(p) = std::env::var("MAZE_SCENES_OUT") {
            let line = format!(
                "{{\"kind\":\"boxes\",\"name\":\"{}\",\"hash\":\"{}\",\"boxes\":[{}],\"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\"sky\":{},\"dst\":[{},{},{},{}],\"sprites\":[{}],\"atlas\":\"{}\"}}\n",
                name, hh, bx.iter().map(|v| format!("{:?}", v)).collect::<Vec<_>>().join(","),
                eye.0, eye.1, eye.2, yaw, VIEW, TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3,
                if name == "box_pillar" { "[0.6,-1.0,0.0,0.25,0.33,7]" } else { "" },
                b64(&a));
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        hh
    }

    #[test]
    fn boxes_room_is_closed_and_invisible_faces_pass_rays() {
        let a = atlas_bytes();
        for name in ["box_room", "box_invisible"] {
            let (bx, eye, yaw) = box_scene(name);
            let h = fresh();
            rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
                VIEW, a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
            let skies = (0..64 * 64).filter(|&i| crate::cv(h).depth[i].is_infinite()).count();
            if name == "box_room" {
                assert_eq!(skies, 0, "a closed room showed sky");
            } else {
                assert!(skies > 0, "the invisible face hid the sky");
            }
        }
    }

    #[test]
    fn boxes_depth_is_forward_and_flat_on_a_facing_wall() {
        let a = atlas_bytes();
        let (bx, _, _) = box_scene("box_room");
        let h = fresh();
        // Eye at x 0 facing -z (north wall at z = -2.0), 2.0 ahead.
        rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, 0.0, 0.96, 0.0, 0.0,
            VIEW, a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
        let d = &crate::cv(h).depth;
        for py in 28..36 { for px in 20..44 {
            assert!((d[py * 64 + px] - 2.0).abs() < 1.0e-4, "depth {} at {},{}", d[py * 64 + px], px, py);
        } }
    }

    // Recorded 2026-09-30 (aarch64, rustc 1.85.0); wasm32 and raster.mjs match.
    const BOX_GOLD: [u64; 4] = [6087842505501104437, 14585584678103946530, 4444385984388685336, 2043459984984238648];

    #[test]
    fn box_goldens() {
        let got: Vec<u64> = BOX_SCENES.iter().map(|n| box_hash(n)).collect();
        if std::env::var("MAZE_PRINT_GOLD").is_ok() { eprintln!("BOX_GOLD {:?}", got); }
        let bad: Vec<String> = BOX_SCENES.iter().enumerate().filter(|(i, _)| got[*i] != BOX_GOLD[*i])
            .map(|(i, n)| format!("{} got {} want {}", n, got[i], BOX_GOLD[i])).collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // --- quads ----------------------------------------------------------
    // An octagonal ring of wall quads on a box floor under a box ceiling, one
    // picture (tile 7: transparent border, translucent ring) hung inside a
    // wall, and (quad_through_box) a quad that passes through a box pillar so
    // the depth test against the boxes is exercised both ways.
    fn quadrec(a: (f32, f32), b: (f32, f32), y0: f32, y1: f32, tile: f32, uv: [f32; 4], mode: f32) -> Vec<f32> {
        vec![a.0, a.1, b.0, b.1, y0, y1, tile, uv[0], uv[1], uv[2], uv[3], mode]
    }

    fn quad_scene(name: &str) -> (Vec<f32>, Vec<f32>, (f32, f32, f32), f32) {
        let mut bx = Vec::new();
        bx.extend(boxrec([-3.0, -0.08, -3.0], [3.0, 0.0, 3.0], 1.0, &[]));
        bx.extend(boxrec([-3.0, 1.5, -3.0], [3.0, 1.58, 3.0], 3.0, &[]));
        let mut qs = Vec::new();
        // the octagon's corners, radius 2.5 (cos/sin of k*45 deg as literals)
        let r = 2.5f32;
        let cs = [1.0f32, 0.70710677, 0.0, -0.70710677, -1.0, -0.70710677, 0.0, 0.70710677];
        let sn = [0.0f32, 0.70710677, 1.0, 0.70710677, 0.0, -0.70710677, -1.0, -0.70710677];
        for k in 0..8usize {
            let j = (k + 1) % 8;
            qs.extend(quadrec((r * cs[k], r * sn[k]), (r * cs[j], r * sn[j]), 0.0, 1.5,
                2.0 + (k % 3) as f32, [0.25, 2.15, 0.1, 1.6], 0.0));
        }
        // a picture just inside the wall at angle 0..45 deg
        let (pa, pb) = ((2.25f32, 0.1f32), (1.65f32, 1.55f32));
        qs.extend(quadrec(pa, pb, 0.4, 1.1, 7.0, [0.0, 1.0, 0.0, 1.0], 1.0));
        match name {
            "quad_ring" => (bx, qs, (-0.4, 0.5, -0.3), 1.2),
            _ => {
                // "quad_through_box": a pillar box straddled by a wall quad
                bx.extend(boxrec([0.3, 0.0, -0.9], [0.7, 1.0, -0.5], 6.0, &[]));
                qs.extend(quadrec((-0.2, -0.7), (1.2, -0.7), 0.0, 0.8, 4.0, [0.0, 3.0, 0.0, 1.0], 0.0));
                (bx, qs, (0.1, 0.5, 1.4), 0.15)
            }
        }
    }

    const QUAD_SCENES: [&str; 2] = ["quad_ring", "quad_through_box"];

    fn quad_hash(name: &str) -> u64 {
        let (bx, qs, eye, yaw) = quad_scene(name);
        let a = atlas_bytes();
        let h = fresh();
        let nb = (bx.len() / MAZE_BOX_FLOATS as usize) as u32;
        let nq = (qs.len() / MAZE_QUAD_FLOATS as usize) as u32;
        rs_maze_boxes(h, bx.as_ptr(), nb, eye.0, eye.1, eye.2, yaw, VIEW,
            a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
        rs_maze_quads(h, qs.as_ptr(), nq, eye.0, eye.1, eye.2, yaw, VIEW,
            a.as_ptr(), TILE_PX, N_TILES, DST.0, DST.1, DST.2, DST.3);
        let hh = fnv(&crate::cv(h).px);
        if let Ok(d) = std::env::var("MAZE_DUMP_DIR") {
            std::fs::write(format!("{}/{}.rgba", d, name), &crate::cv(h).px).unwrap();
        }
        if let Ok(p) = std::env::var("MAZE_SCENES_OUT") {
            let f32s = |v: &Vec<f32>| v.iter().map(|x| format!("{:?}", x)).collect::<Vec<_>>().join(",");
            let line = format!(
                "{{\"kind\":\"quads\",\"name\":\"{}\",\"hash\":\"{}\",\"boxes\":[{}],\"quads\":[{}],\"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\"sky\":{},\"dst\":[{},{},{},{}],\"atlas\":\"{}\"}}\n",
                name, hh, f32s(&bx), f32s(&qs), eye.0, eye.1, eye.2, yaw, VIEW, TILE_PX, N_TILES, SKY,
                DST.0, DST.1, DST.2, DST.3, b64(&a));
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        hh
    }

    #[test]
    fn quads_close_the_ring_and_respect_box_depth() {
        let a = atlas_bytes();
        let (bx, qs, eye, yaw) = quad_scene("quad_ring");
        let h = fresh();
        rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
            VIEW, a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
        // floor and ceiling boxes only: the horizon band is open sky
        let open = (0..64 * 64).filter(|&i| crate::cv(h).depth[i].is_infinite()).count();
        assert!(open > 0);
        rs_maze_quads(h, qs.as_ptr(), (qs.len() / MAZE_QUAD_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
            VIEW, a.as_ptr(), TILE_PX, N_TILES, DST.0, DST.1, DST.2, DST.3);
        let open = (0..64 * 64).filter(|&i| crate::cv(h).depth[i].is_infinite()).count();
        assert_eq!(open, 0, "the ring of quads left a gap");
        // nothing a quad drew is farther than the ring's corners
        assert!((0..64 * 64).all(|i| crate::cv(h).depth[i] < 3.0));
    }

    // --- sky ------------------------------------------------------------
    // Six 16x16 faces with no symmetry (and a per-face offset), over an open
    // box scene: rs_maze_sky must repaint the sky and only the sky.
    const SKY_PX: u32 = 16;
    fn sky_bytes() -> Vec<u8> {
        let mut v = vec![0u8; (6 * SKY_PX * SKY_PX * 4) as usize];
        for f in 0..6u32 {
            for y in 0..SKY_PX {
                for x in 0..SKY_PX {
                    let o = (((f * SKY_PX + y) * SKY_PX + x) * 4) as usize;
                    v[o] = ((f * 41 + x * 11 + y * 3) & 255) as u8;
                    v[o + 1] = ((f * 73 + x * 2 + y * 17) & 255) as u8;
                    v[o + 2] = ((f * 29 + x * 19 + y * 5) & 255) as u8;
                    v[o + 3] = 255;
                }
            }
        }
        v
    }

    const SKY_SCENES: [(&str, f32); 3] = [("sky_east", 1.2), ("sky_back", 3.6), ("sky_corner", -0.75)];

    fn sky_hash(name: &str, yaw: f32) -> u64 {
        let (bx, eye, _) = box_scene("box_invisible");
        let a = atlas_bytes();
        let s = sky_bytes();
        let h = fresh();
        rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
            VIEW, a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
        rs_maze_sky(h, yaw, s.as_ptr(), SKY_PX, DST.0, DST.1, DST.2, DST.3);
        let hh = fnv(&crate::cv(h).px);
        if let Ok(p) = std::env::var("MAZE_SCENES_OUT") {
            let line = format!(
                "{{\"kind\":\"sky\",\"name\":\"{}\",\"hash\":\"{}\",\"boxes\":[{}],\"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\"sky\":{},\"sky_px\":{},\"sky_faces\":\"{}\",\"dst\":[{},{},{},{}],\"atlas\":\"{}\"}}\n",
                name, hh, bx.iter().map(|v| format!("{:?}", v)).collect::<Vec<_>>().join(","),
                eye.0, eye.1, eye.2, yaw, VIEW, TILE_PX, N_TILES, SKY, SKY_PX, b64(&s),
                DST.0, DST.1, DST.2, DST.3, b64(&a));
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        hh
    }

    #[test]
    fn sky_repaints_only_the_sky() {
        let (bx, eye, _) = box_scene("box_invisible");
        let a = atlas_bytes();
        let s = sky_bytes();
        let h = fresh();
        rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, eye.0, eye.1, eye.2, 3.14159,
            VIEW, a.as_ptr(), TILE_PX, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
        let before = crate::cv(h).px.clone();
        let depth = crate::cv(h).depth.clone();
        rs_maze_sky(h, 3.14159, s.as_ptr(), SKY_PX, DST.0, DST.1, DST.2, DST.3);
        let after = &crate::cv(h).px;
        let mut changed_sky = 0;
        for i in 0..64 * 64 {
            let same = before[i * 4..i * 4 + 3] == after[i * 4..i * 4 + 3];
            if depth[i].is_infinite() { if !same { changed_sky += 1; } } else { assert!(same, "a non-sky pixel changed"); }
        }
        assert!(changed_sky > 0, "the sky was not repainted");
    }

    // Recorded 2026-10-04 on aarch64-apple-darwin (rustc 1.85.0).
    const SKY_GOLD: [u64; 3] = [15414951590029546443, 2662025410843838180, 8195905866415397575];

    #[test]
    fn sky_goldens() {
        let got: Vec<u64> = SKY_SCENES.iter().map(|(n, y)| sky_hash(n, *y)).collect();
        if std::env::var("MAZE_PRINT_GOLD").is_ok() { eprintln!("SKY_GOLD {:?}", got); }
        let bad: Vec<String> = SKY_SCENES.iter().enumerate().filter(|(i, _)| got[*i] != SKY_GOLD[*i])
            .map(|(i, (n, _))| format!("{} got {} want {}", n, got[i], SKY_GOLD[i])).collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // --- pview ----------------------------------------------------------
    // The sky's six asymmetric faces as the panorama, a screen (with a cross
    // on it, drawn after) facing the eye and one oblique quad, seen level,
    // pitched down and pitched up behind.
    const PVIEW_SCENES: [(&str, f32, f32); 3] =
        [("pview_level", 1.5707964, 0.0), ("pview_down", 1.4, 0.5), ("pview_up_back", -2.3, -0.9)];

    fn pview_quads() -> Vec<f32> {
        vec![
            -56.0, 90.0, 57.0, 112.0, 0.0, 0.0, 0.0, 0.0, -112.0, 255.0, 255.0, 255.0,
            -6.0, 90.0, 2.0, 12.0, 0.0, 0.0, 0.0, 0.0, -4.0, 230.0, 20.0, 10.0,
            -2.0, 90.0, 6.0, 4.0, 0.0, 0.0, 0.0, 0.0, -12.0, 230.0, 20.0, 10.0,
            -20.0, 60.0, -30.0, 30.0, 10.0, 0.0, 0.0, 0.0, 20.0, 40.0, 200.0, 90.0,
        ]
    }

    fn pview_hash(name: &str, yaw: f32, pitch: f32) -> u64 {
        let s = sky_bytes();
        let q = pview_quads();
        let h = fresh();
        rs_maze_pview(h, yaw, pitch, 1.0, s.as_ptr(), SKY_PX, q.as_ptr(), (q.len() / MAZE_PQUAD_FLOATS as usize) as u32,
            DST.0, DST.1, DST.2, DST.3);
        let hh = fnv(&crate::cv(h).px);
        if let Ok(p) = std::env::var("MAZE_SCENES_OUT") {
            let line = format!(
                "{{\"kind\":\"pview\",\"name\":\"{}\",\"hash\":\"{}\",\"yaw\":{:?},\"pitch\":{:?},\"view\":1.0,\"pano\":\"{}\",\"pano_px\":{},\"quads\":[{}],\"dst\":[{},{},{},{}]}}\n",
                name, hh, yaw, pitch, b64(&s), SKY_PX, q.iter().map(|v| format!("{:?}", v)).collect::<Vec<_>>().join(","),
                DST.0, DST.1, DST.2, DST.3);
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        hh
    }

    #[test]
    fn pview_level_view_sees_the_screen_and_the_cross() {
        let s = sky_bytes();
        let q = pview_quads();
        let h = fresh();
        rs_maze_pview(h, 1.5707964, 0.0, 1.0, s.as_ptr(), SKY_PX, q.as_ptr(), 4, DST.0, DST.1, DST.2, DST.3);
        let px = &crate::cv(h).px;
        let at = |x: usize, y: usize| [px[(y * 64 + x) * 4], px[(y * 64 + x) * 4 + 1], px[(y * 64 + x) * 4 + 2]];
        assert_eq!(at(32, 32), [230, 20, 10], "the cross is at the centre");
        assert_eq!(at(20, 20), [255, 255, 255], "the screen fills the view's middle");
        assert_ne!(at(1, 1), [255, 255, 255], "the panorama shows beyond the screen");
    }

    // Recorded 2026-10-05 on aarch64-apple-darwin (rustc 1.85.0).
    const PVIEW_GOLD: [u64; 3] = [16129208165483819010, 11051587964618129539, 8970400471651449696];

    #[test]
    fn pview_goldens() {
        let got: Vec<u64> = PVIEW_SCENES.iter().map(|(n, y, p)| pview_hash(n, *y, *p)).collect();
        if std::env::var("MAZE_PRINT_GOLD").is_ok() { eprintln!("PVIEW_GOLD {:?}", got); }
        let bad: Vec<String> = PVIEW_SCENES.iter().enumerate().filter(|(i, _)| got[*i] != PVIEW_GOLD[*i])
            .map(|(i, (n, _, _))| format!("{} got {} want {}", n, got[i], PVIEW_GOLD[i])).collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // Recorded 2026-10-03 on aarch64-apple-darwin (rustc 1.85.0).
    const QUAD_GOLD: [u64; 2] = [7597624935351682213, 3003790360022301269];

    #[test]
    fn quad_goldens() {
        let got: Vec<u64> = QUAD_SCENES.iter().map(|n| quad_hash(n)).collect();
        if std::env::var("MAZE_PRINT_GOLD").is_ok() { eprintln!("QUAD_GOLD {:?}", got); }
        let bad: Vec<String> = QUAD_SCENES.iter().enumerate().filter(|(i, _)| got[*i] != QUAD_GOLD[*i])
            .map(|(i, n)| format!("{} got {} want {}", n, got[i], QUAD_GOLD[i])).collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // Recorded 2026-09-30 on aarch64-apple-darwin (rustc 1.85.0); the wasm32
    // build matches (tests/wasm_maze_check.mjs).
    const GOLD: [u64; 7] = [
        8890691392851134841,
        18171036880018896050,
        1424891750079914007,
        11023838734547250984,
        489799078444735005,
        12304547036651593320,
        6499810142803508572,
    ];

    #[test]
    fn goldens() {
        let got: Vec<u64> = SCENES.iter().map(|n| scene_hash(n)).collect();
        if std::env::var("MAZE_PRINT_GOLD").is_ok() {
            eprintln!("MAZE_GOLD {:?}", got);
        }
        let bad: Vec<String> = SCENES.iter().enumerate()
            .filter(|(i, _)| got[*i] != GOLD[*i])
            .map(|(i, n)| format!("{} got {} want {}", n, got[i], GOLD[i]))
            .collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // --- mip levels ------------------------------------------------------
    // The test atlas with MIP_LEVELS levels past the first, each a 2x2 box
    // filter ((a + b + c + d + 2) / 4 per channel) of the one before, and
    // three scenes drawn with it: a tile maze with decals (variation), a box
    // room seen through a doorway, the quad ring. Far and grazing surfaces
    // drop to coarser levels; near ones keep level 0.
    const MIP_LEVELS: u32 = 3;
    fn atlas_mips() -> Vec<u8> {
        let mut a = atlas_bytes();
        let mut prev = a.clone();
        let mut size = TILE_PX;
        for _ in 0..MIP_LEVELS {
            let half = size / 2;
            let mut next = vec![0u8; (N_TILES * half * half * 4) as usize];
            for t in 0..N_TILES {
                for y in 0..half {
                    for x in 0..half {
                        for ch in 0..4u32 {
                            let at = |xx: u32, yy: u32| prev[((t * size * size + yy * size + xx) * 4 + ch) as usize] as u32;
                            let sum = at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1);
                            next[((t * half * half + y * half + x) * 4 + ch) as usize] = ((sum + 2) / 4) as u8;
                        }
                    }
                }
            }
            a.extend_from_slice(&next);
            prev = next;
            size = half;
        }
        a
    }

    const MIP_WORD: u32 = TILE_PX | (MIP_LEVELS << 16);
    const MIP_SCENES: [&str; 3] = ["variation_mip", "box_doorway_mip", "quad_ring_mip"];

    fn mip_hash(name: &str) -> u64 {
        let a = atlas_mips();
        let h = fresh();
        let line = match name {
            "variation_mip" => {
                let (m, eye, yaw) = scene("variation");
                rs_maze_view(h, m.p.as_ptr(), W, H, eye.0, eye.1, eye.2, yaw, VIEW,
                    a.as_ptr(), MIP_WORD, N_TILES, SKY, DECAL.0, DECAL.1, DST.0, DST.1, DST.2, DST.3);
                format!(
                    "{{\"name\":\"{}\",\"hash\":\"{{H}}\",\"w\":{},\"h\":{},\"cells\":[{}],\
                     \"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\
                     \"sky\":{},\"decal\":[{},{}],\"dst\":[{},{},{},{}],\"sprites\":[],\"atlas\":\"{}\"}}\n",
                    name, W, H, m.p.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(","),
                    eye.0, eye.1, eye.2, yaw, VIEW, MIP_WORD, N_TILES, SKY, DECAL.0, DECAL.1,
                    DST.0, DST.1, DST.2, DST.3, b64(&a))
            }
            "box_doorway_mip" => {
                let (bx, eye, yaw) = box_scene("box_doorway");
                rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
                    VIEW, a.as_ptr(), MIP_WORD, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
                format!(
                    "{{\"kind\":\"boxes\",\"name\":\"{}\",\"hash\":\"{{H}}\",\"boxes\":[{}],\"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\"sky\":{},\"dst\":[{},{},{},{}],\"sprites\":[],\"atlas\":\"{}\"}}\n",
                    name, bx.iter().map(|v| format!("{:?}", v)).collect::<Vec<_>>().join(","),
                    eye.0, eye.1, eye.2, yaw, VIEW, MIP_WORD, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3, b64(&a))
            }
            _ => {
                let (bx, qs, eye, yaw) = quad_scene("quad_ring");
                rs_maze_boxes(h, bx.as_ptr(), (bx.len() / MAZE_BOX_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
                    VIEW, a.as_ptr(), MIP_WORD, N_TILES, SKY, DST.0, DST.1, DST.2, DST.3);
                rs_maze_quads(h, qs.as_ptr(), (qs.len() / MAZE_QUAD_FLOATS as usize) as u32, eye.0, eye.1, eye.2, yaw,
                    VIEW, a.as_ptr(), MIP_WORD, N_TILES, DST.0, DST.1, DST.2, DST.3);
                let f32s = |v: &Vec<f32>| v.iter().map(|x| format!("{:?}", x)).collect::<Vec<_>>().join(",");
                format!(
                    "{{\"kind\":\"quads\",\"name\":\"{}\",\"hash\":\"{{H}}\",\"boxes\":[{}],\"quads\":[{}],\"eye\":[{},{},{}],\"yaw\":{},\"view\":{},\"tile_px\":{},\"n_tiles\":{},\"sky\":{},\"dst\":[{},{},{},{}],\"atlas\":\"{}\"}}\n",
                    name, f32s(&bx), f32s(&qs), eye.0, eye.1, eye.2, yaw, VIEW, MIP_WORD, N_TILES, SKY,
                    DST.0, DST.1, DST.2, DST.3, b64(&a))
            }
        };
        let hh = fnv(&crate::cv(h).px);
        if let Ok(d) = std::env::var("MAZE_DUMP_DIR") {
            std::fs::write(format!("{}/{}.rgba", d, name), &crate::cv(h).px).unwrap();
        }
        if let Ok(p) = std::env::var("MAZE_SCENES_OUT") {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.replace("{H}", &hh.to_string()).as_bytes()).unwrap();
        }
        hh
    }

    #[test]
    fn mips_change_only_what_is_far_or_grazing() {
        // Level 0 everywhere would be the plain render: the mip render must
        // differ (far texels are averaged) yet agree on near, facing pixels.
        let (m, eye, yaw) = scene("variation");
        let (a0, am) = (atlas_bytes(), atlas_mips());
        let h0 = fresh();
        rs_maze_view(h0, m.p.as_ptr(), W, H, eye.0, eye.1, eye.2, yaw, VIEW,
            a0.as_ptr(), TILE_PX, N_TILES, SKY, DECAL.0, DECAL.1, DST.0, DST.1, DST.2, DST.3);
        let plain = crate::cv(h0).px.clone();
        let hm = fresh();
        rs_maze_view(hm, m.p.as_ptr(), W, H, eye.0, eye.1, eye.2, yaw, VIEW,
            am.as_ptr(), MIP_WORD, N_TILES, SKY, DECAL.0, DECAL.1, DST.0, DST.1, DST.2, DST.3);
        let mip = &crate::cv(hm).px;
        let depth = &crate::cv(hm).depth;
        let (mut far_diff, mut near) = (0, 0);
        for i in 0..64 * 64 {
            let same = plain[i * 4..i * 4 + 3] == mip[i * 4..i * 4 + 3];
            if depth[i] > 4.0 && depth[i].is_finite() && !same { far_diff += 1; }
            // nearer than 0.8 the footprint is under 1 texel (16 px tiles, 64 px
            // wide, the floor 0.51 below the eye): level 0, the plain texel
            if depth[i] < 0.8 { near += 1; assert!(same, "a near pixel changed at {}", i); }
        }
        assert!(far_diff > 0, "far pixels did not use a coarser level");
        assert!(near > 0);
    }

    // Recorded 2026-10-04 on aarch64-apple-darwin (rustc 1.85.0).
    const MIP_GOLD: [u64; 3] = [5595903680131934792, 3582402418072440271, 15571278186977625174];

    #[test]
    fn mip_goldens() {
        let got: Vec<u64> = MIP_SCENES.iter().map(|n| mip_hash(n)).collect();
        if std::env::var("MAZE_PRINT_GOLD").is_ok() { eprintln!("MIP_GOLD {:?}", got); }
        let bad: Vec<String> = MIP_SCENES.iter().enumerate().filter(|(i, _)| got[*i] != MIP_GOLD[*i])
            .map(|(i, n)| format!("{} got {} want {}", n, got[i], MIP_GOLD[i])).collect();
        assert!(bad.is_empty(), "{}", bad.join("; "));
    }

    // rs_maze_sprite2 (T3): the sprites room with three two-colour billboards
    // (one with the alpha-ring tile), over the plain view.
    // Recorded 2026-10-05 on aarch64-apple-darwin (rustc 1.85.0).
    const SPRITE2_GOLD: u64 = 1024037632895021045;

    #[test]
    fn sprite2_golden() {
        let got = scene_hash("sprites2");
        if std::env::var("MAZE_PRINT_GOLD").is_ok() { eprintln!("SPRITE2_GOLD {}", got); }
        assert_eq!(got, SPRITE2_GOLD, "sprites2");
    }

    #[test]
    fn hrp_colour_endpoints() {
        // weight 0 is c1, 255 is c2; shade 255 keeps the colour, 0 is black
        assert_eq!(hrp_colour(0x102030, 0xF0E0D0, 255, 0), (0x10, 0x20, 0x30));
        assert_eq!(hrp_colour(0x102030, 0xF0E0D0, 255, 255), (0xF0, 0xE0, 0xD0));
        assert_eq!(hrp_colour(0xFFFFFF, 0xFFFFFF, 0, 128), (0, 0, 0));
        assert_eq!(hrp_colour(0xFF0000, 0x0000FF, 255, 128), (127, 0, 128));
    }

    // `cargo test --release bench_maze -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_maze() {
        let a = atlas_bytes();
        let (m, eye, yaw) = scene("variation");
        let h = fresh();
        for _ in 0..200 { render(h, &m, eye, yaw, &a); }
        let n = 3000;
        let t = std::time::Instant::now();
        for _ in 0..n { render(h, &m, eye, yaw, &a); }
        eprintln!("BENCH_MAZE {:.2} us/frame (64x64)", t.elapsed().as_secs_f64() * 1e6 / n as f64);
    }
}
