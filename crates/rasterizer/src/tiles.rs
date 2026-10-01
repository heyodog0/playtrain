//! Tile-grid blit: one call draws a whole grid of tiles into a device-pixel rect.
//!
//! `rs_draw_tiles(canvas, kinds, gw, gh, atlas, tile_px, n_tiles, dst_x, dst_y, dst_w, dst_h)`
//!
//! `kinds[gy*gw+gx]` selects a tile; a value `>= n_tiles` is transparent (the
//! cell is left as it was, so `background()` first gives an empty-cell colour).
//! `atlas` holds `n_tiles` square RGBA tiles of `tile_px` texels each, in
//! order; `tile_px == 1` is a palette. Nearest-neighbour, integer-only, so the
//! native and wasm builds agree byte for byte. Alpha is copied, not blended.
//!
//! The grid games this exists for (VGDL, PuzzleScript, tile RL envs) spend
//! more time issuing one `rect()` per cell than on their logic; this replaces
//! hundreds of host calls a frame with one.
//!
//! Dirty-frame mode: `rs_frame_begin`/`rs_frame_end` record a frame's ops and
//! skip the frame if the stream repeats. A direct pixel write during recording
//! would run before the replayed ops and be overwritten, and a grid change
//! would not change the stream, so the op is recorded WITH a copy of its data
//! and a content hash, and executed on replay like every other op.

use crate::{cv, rec, rs};

pub(crate) struct TilesOp {
    canvas: u32,
    kinds: Vec<u16>,
    atlas: Vec<u8>,
    gw: u32,
    gh: u32,
    tile_px: u32,
    n_tiles: u32,
    dst: [u32; 4],
}

#[derive(Default)]
pub(crate) struct Tiles {
    pub(crate) ops: Vec<TilesOp>,
    // staging buffers for the wasm shim (JS cannot make a pointer into linear
    // memory; it writes through these, exactly as voxel.rs does)
    kinds_stage: Vec<u16>,
    atlas_stage: Vec<u8>,
}

fn tiles() -> &'static mut Tiles {
    let s = rs();
    if s.tiles.is_none() {
        s.tiles = Some(Box::new(Tiles::default()));
    }
    s.tiles.as_mut().unwrap()
}

pub(crate) fn tiles_frame_begin() {
    if let Some(t) = rs().tiles.as_mut() {
        t.ops.clear();
    }
}

fn hash_bytes(mut h: u64, b: &[u8]) -> u64 {
    for &x in b {
        h ^= x as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

#[allow(clippy::too_many_arguments)]
fn draw(
    canvas: u32,
    kinds: &[u16],
    gw: u32,
    gh: u32,
    atlas: &[u8],
    tile_px: u32,
    n_tiles: u32,
    dst: [u32; 4],
) {
    let (dst_x, dst_y, dst_w, dst_h) = (dst[0], dst[1], dst[2], dst[3]);
    if gw == 0 || gh == 0 || dst_w == 0 || dst_h == 0 || tile_px == 0 || n_tiles == 0 {
        return;
    }
    if kinds.len() < (gw * gh) as usize {
        return;
    }
    let tstride = (tile_px * tile_px * 4) as usize;
    if atlas.len() < tstride * n_tiles as usize {
        return;
    }
    let c = cv(canvas);
    let (cw, ch) = (c.dw, c.dh);
    let (gwu, ghu, tp) = (gw as usize, gh as usize, tile_px as usize);
    let (dwu, dhu) = (dst_w as usize, dst_h as usize);
    for py in 0..dhu {
        let cy = dst_y as usize + py;
        if cy >= ch {
            break;
        }
        let gy = (py * ghu) / dhu;               // cell row
        let ty = ((py * ghu) % dhu) * tp / dhu;  // texel row within the tile
        let row = cy * cw;
        for px in 0..dwu {
            let cx = dst_x as usize + px;
            if cx >= cw {
                break;
            }
            let gx = (px * gwu) / dwu;
            let k = kinds[gy * gwu + gx] as u32;
            if k >= n_tiles {
                continue;
            }
            let tx = ((px * gwu) % dwu) * tp / dwu;
            let so = k as usize * tstride + (ty * tp + tx) * 4;
            let doff = (row + cx) * 4;
            c.px[doff..doff + 4].copy_from_slice(&atlas[so..so + 4]);
        }
    }
}

pub(crate) fn replay_tiles(idx: usize) {
    let s = rs();
    let Some(t) = s.tiles.as_ref() else { return };
    let Some(op) = t.ops.get(idx) else { return };
    // copy out so `draw` can borrow the canvas mutably
    let (canvas, gw, gh, tile_px, n_tiles, dst) = (op.canvas, op.gw, op.gh, op.tile_px, op.n_tiles, op.dst);
    let kinds = op.kinds.clone();
    let atlas = op.atlas.clone();
    draw(canvas, &kinds, gw, gh, &atlas, tile_px, n_tiles, dst);
}

#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn rs_draw_tiles(
    canvas: u32,
    kinds: *const u16,
    gw: u32,
    gh: u32,
    atlas: *const u8,
    tile_px: u32,
    n_tiles: u32,
    dst_x: u32,
    dst_y: u32,
    dst_w: u32,
    dst_h: u32,
) {
    if kinds.is_null() || atlas.is_null() || gw == 0 || gh == 0 || tile_px == 0 || n_tiles == 0 {
        return;
    }
    let nk = (gw * gh) as usize;
    let na = (tile_px * tile_px * 4 * n_tiles) as usize;
    let kinds_s = unsafe { core::slice::from_raw_parts(kinds, nk) };
    let atlas_s = unsafe { core::slice::from_raw_parts(atlas, na) };
    let dst = [dst_x, dst_y, dst_w, dst_h];
    if rs().recording {
        let mut h = hash_bytes(1469598103934665603, unsafe { core::slice::from_raw_parts(kinds as *const u8, nk * 2) });
        h = hash_bytes(h, atlas_s);
        let t = tiles();
        let idx = t.ops.len();
        t.ops.push(TilesOp { canvas, kinds: kinds_s.to_vec(), atlas: atlas_s.to_vec(), gw, gh, tile_px, n_tiles, dst });
        // tag 20: [op index, content hash (two halves), gw, gh, packed dst]; a
        // content change changes the frame hash, so an unchanged stream with a
        // changed grid is never skipped.
        let packed = ((dst_x as u64) << 48 | (dst_y as u64) << 32 | (dst_w as u64) << 16 | dst_h as u64) as f64;
        rec(20, [idx as f64, (h >> 32) as f64, (h & 0xffff_ffff) as f64, gw as f64, gh as f64, packed]);
        return;
    }
    draw(canvas, kinds_s, gw, gh, atlas_s, tile_px, n_tiles, dst);
}

// ---- wasm staging (see raster-wasm.mjs) ----
#[no_mangle]
pub extern "C" fn rs_tiles_kinds_ptr(n: u32) -> *mut u16 {
    let t = tiles();
    if t.kinds_stage.len() < n as usize {
        t.kinds_stage.resize(n as usize, 0);
    }
    t.kinds_stage.as_mut_ptr()
}
#[no_mangle]
pub extern "C" fn rs_tiles_atlas_ptr(nbytes: u32) -> *mut u8 {
    let t = tiles();
    if t.atlas_stage.len() < nbytes as usize {
        t.atlas_stage.resize(nbytes as usize, 0);
    }
    t.atlas_stage.as_mut_ptr()
}
