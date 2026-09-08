// three.rs — software 3D pipeline for p5 WEBGL-mode games (P5_WEBGL_PLAN.md).
//
// Everything 3D lives here, behind `rs_3d_*` extern "C" calls: the model
// matrix stack, the fixed default camera, lights, materials, tessellated
// primitives, a z-buffer and a fixed-point triangle rasterizer. The C++ p5
// layer (native/runtime/p5.cpp) and the JS shim stay thin forwarders, exactly
// like the 2D surface, so QuickJS-native and V8-wasm produce identical pixels
// from one Rust source.
//
// Declared subset (the Tier-1 spec): createCanvas(w,h,WEBGL); push/pop;
// translate(x,y[,z]); rotateX/Y/Z; fill; ambientMaterial; specularMaterial;
// shininess; ambientLight; directionalLight; pointLight; box; sphere;
// ellipsoid; cylinder; cone. No texture/text/camera/perspective/ortho/scale,
// no strokes in WEBGL mode.
//
// Determinism rules (see plan § "Renderer spec"):
//   * only IEEE add/mul/div/sqrt/round plus the fdlibm-kernel trig below —
//     never f64::sin/cos/powf (libm differs per platform);
//   * every buffer is allocated in rs_3d_begin (canvas creation) and reused;
//     the per-frame path performs zero heap allocation (Hazard 1: glibc
//     arena convoys on the async trainer path);
//   * golden-hash tests (tests/three_golden.rs) pin the output; native and
//     wasm32 must hash identically.
//
// Conventions (p5 WEBGL): origin at canvas centre, +x right, +y DOWN on
// screen, +z toward the viewer. Default camera = p5's: fov PI/3, aspect w/h,
// eye at (0,0,(h/2)/tan(PI/6)) looking at the origin, near 0.1*eyeZ, far
// 10*eyeZ (p5.RendererGL._computeCameraDefaultSettings / perspective()).
// cylinder() runs along the y axis. cone() has its base at +h/2 (screen-down)
// and apex at -h/2 (screen-up) — the orientation seaquest.v3 evidently
// expects (dorsal fin, sub tail cone); recorded as the template convention.

use crate::{clamp_u8, rs, Canvas};

// ---------------------------------------------------------------- trig ----
// fdlibm __kernel_sin/__kernel_cos on an argument Cody–Waite-reduced to
// [-pi/4, pi/4]. Pure IEEE ops => bit-identical on every target. Reduction is
// the fdlibm medium-argument path (two-part pi/2); accurate to well under an
// ULP of the result for |x| < ~1e6, which covers any rotation a game issues.
// (Not linked to the vendored openlibm because the wasm build of this crate
// has zero imports; the game-visible Math.sin/cos still go through fm_sin.)
const S1: f64 = -1.66666666666666324348e-01;
const S2: f64 = 8.33333333332248946124e-03;
const S3: f64 = -1.98412698298579493134e-04;
const S4: f64 = 2.75573137070700676789e-06;
const S5: f64 = -2.50507602534068634195e-08;
const S6: f64 = 1.58969099521155010221e-10;
const C1: f64 = 4.16666666666666019037e-02;
const C2: f64 = -1.38888888888741095749e-03;
const C3: f64 = 2.48015872894767294178e-05;
const C4: f64 = -2.75573143513906633035e-07;
const C5: f64 = 2.08757232129817482790e-09;
const C6: f64 = -1.13596475577881948265e-11;
const PIO2_1: f64 = 1.57079632673412561417e+00;
const PIO2_1T: f64 = 6.07710050650619224932e-11;
const INV_PIO2: f64 = 6.36619772367581382433e-01;
const PIO4: f64 = 0.7853981633974483;

#[inline]
fn ksin(x: f64) -> f64 {
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    x + v * (S1 + z * r)
}
#[inline]
fn kcos(x: f64) -> f64 {
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    let hz = 0.5 * z;
    let w = 1.0 - hz;
    w + (((1.0 - w) - hz) + z * r)
}
/// (sin x, cos x), deterministic. Non-finite or absurd inputs return (0, 1)
/// so a NaN angle from a game can never poison the matrix stack.
pub fn sincos(x: f64) -> (f64, f64) {
    if !x.is_finite() || x.abs() > 1.0e9 {
        return (0.0, 1.0);
    }
    if x.abs() <= PIO4 {
        return (ksin(x), kcos(x));
    }
    let fnn = (x * INV_PIO2).round();
    let r = (x - fnn * PIO2_1) - fnn * PIO2_1T;
    let (s, c) = (ksin(r), kcos(r));
    match (fnn as i64) & 3 {
        0 => (s, c),
        1 => (c, -s),
        2 => (-s, -c),
        _ => (-c, s),
    }
}

// Integer power by repeated squaring: the only pow the shader needs
// (shininess is rounded to an integer >= 1, p5 clamps it to >= 1 too).
#[inline]
fn powi(mut b: f64, mut e: u32) -> f64 {
    let mut acc = 1.0;
    while e > 0 {
        if e & 1 == 1 {
            acc *= b;
        }
        b *= b;
        e >>= 1;
    }
    acc
}

// ------------------------------------------------------------- matrices ----
// Column-major 4x4 (GL layout): m[col*4 + row]. All model transforms are
// affine so row 3 stays (0,0,0,1) and is never read.
pub type M4 = [f64; 16];
const IDENT: M4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];

#[inline]
fn m_translate(m: &mut M4, x: f64, y: f64, z: f64) {
    m[12] += m[0] * x + m[4] * y + m[8] * z;
    m[13] += m[1] * x + m[5] * y + m[9] * z;
    m[14] += m[2] * x + m[6] * y + m[10] * z;
}
// M = M * R_axis(a). Post-multiplying rotates about the object's local axis,
// which is what p5's rotateX/Y/Z do (uMVMatrix.rotate).
#[inline]
fn m_rotate_x(m: &mut M4, a: f64) {
    let (s, c) = sincos(a);
    for r in 0..3 {
        let c1 = m[4 + r];
        let c2 = m[8 + r];
        m[4 + r] = c1 * c + c2 * s;
        m[8 + r] = -c1 * s + c2 * c;
    }
}
#[inline]
fn m_rotate_y(m: &mut M4, a: f64) {
    let (s, c) = sincos(a);
    for r in 0..3 {
        let c0 = m[r];
        let c2 = m[8 + r];
        m[r] = c0 * c - c2 * s;
        m[8 + r] = c0 * s + c2 * c;
    }
}
#[inline]
fn m_rotate_z(m: &mut M4, a: f64) {
    let (s, c) = sincos(a);
    for r in 0..3 {
        let c0 = m[r];
        let c1 = m[4 + r];
        m[r] = c0 * c + c1 * s;
        m[4 + r] = -c0 * s + c1 * c;
    }
}

#[inline]
fn normalize3(v: [f64; 3]) -> [f64; 3] {
    let l2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if l2 <= 0.0 {
        return [0.0, 0.0, 1.0];
    }
    let inv = 1.0 / l2.sqrt();
    [v[0] * inv, v[1] * inv, v[2] * inv]
}
#[inline]
fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

// --------------------------------------------------------------- meshes ----
// Unit primitives, tessellated ONCE per state (rs_3d_begin). A draw call
// scales the unit mesh by (sx,sy,sz) and pushes it through the model matrix;
// nothing is allocated per call. Triangle winding is CCW seen from outside
// (right-handed, y up) — the rasterizer culls the other orientation, so a
// tessellator that gets this wrong shows up as an inside-out solid in the
// golden tests, not as a silent slowdown.
struct Mesh {
    pos: Vec<[f64; 3]>,
    nrm: Vec<[f64; 3]>,
    idx: Vec<[u32; 3]>,
}

impl Mesh {
    fn new() -> Mesh {
        Mesh { pos: Vec::new(), nrm: Vec::new(), idx: Vec::new() }
    }
    fn push(&mut self, p: [f64; 3], n: [f64; 3]) -> u32 {
        self.pos.push(p);
        self.nrm.push(n);
        (self.pos.len() - 1) as u32
    }
    fn tri(&mut self, a: u32, b: u32, c: u32) {
        self.idx.push([a, b, c]);
    }
}

// Angle table for a ring of `n` segments: theta_j = 2*pi*j/n, evaluated with
// the same sincos as the transforms.
fn ring(n: usize) -> Vec<(f64, f64)> {
    let mut v = Vec::with_capacity(n);
    for j in 0..n {
        let t = 2.0 * core::f64::consts::PI * (j as f64 / n as f64);
        let (s, c) = sincos(t);
        v.push((c, s));
    }
    v
}

// Unit box [-0.5,0.5]^3, six flat faces, 24 vertices, 12 triangles.
fn mesh_box() -> Mesh {
    let mut m = Mesh::new();
    // (normal, u axis, v axis) per face; quad = c - u - v, c + u - v, c + u + v, c - u + v
    let faces: [([f64; 3], [f64; 3], [f64; 3]); 6] = [
        ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]),   // +z (front)
        ([0.0, 0.0, -1.0], [-1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), // -z
        ([1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]),  // +x
        ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]),  // -x
        ([0.0, 1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, -1.0]),  // +y
        ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]),  // -y
    ];
    for (n, u, v) in faces.iter() {
        let c = [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5];
        let p = |su: f64, sv: f64| {
            [c[0] + 0.5 * (su * u[0] + sv * v[0]), c[1] + 0.5 * (su * u[1] + sv * v[1]), c[2] + 0.5 * (su * u[2] + sv * v[2])]
        };
        let a = m.push(p(-1.0, -1.0), *n);
        let b = m.push(p(1.0, -1.0), *n);
        let cc = m.push(p(1.0, 1.0), *n);
        let d = m.push(p(-1.0, 1.0), *n);
        m.tri(a, b, cc);
        m.tri(a, cc, d);
    }
    m
}

// Unit sphere, p5's UV parametrisation (detailX around, detailY pole to pole).
fn mesh_sphere(dx: usize, dy: usize) -> Mesh {
    let mut m = Mesh::new();
    let rg = ring(dx);
    for i in 0..=dy {
        let v = i as f64 / dy as f64;
        let phi = core::f64::consts::PI * v - core::f64::consts::PI / 2.0;
        let (sp, cp) = sincos(phi);
        for j in 0..=dx {
            let (ct, st) = rg[j % dx];
            let p = [cp * st, sp, cp * ct];
            m.push(p, p);
        }
    }
    let row = (dx + 1) as u32;
    for i in 0..dy as u32 {
        for j in 0..dx as u32 {
            let a = i * row + j;
            let b = a + 1;
            let c = a + row;
            let d = c + 1;
            // phi increases with +y (down on screen); outward CCW winding:
            m.tri(a, c, d);
            m.tri(a, d, b);
        }
    }
    m
}

// Unit cylinder along y: radius 1, y in [-0.5, 0.5], flat caps.
fn mesh_cylinder(dx: usize) -> Mesh {
    let mut m = Mesh::new();
    let rg = ring(dx);
    // side: two rings, smooth radial normals
    for j in 0..=dx {
        let (c, s) = rg[j % dx];
        let n = [c, 0.0, s];
        m.push([c, -0.5, s], n);
        m.push([c, 0.5, s], n);
    }
    for j in 0..dx as u32 {
        let a = 2 * j;      // bottom (y=-0.5)
        let b = a + 1;      // top    (y=+0.5)
        let c = a + 2;
        let d = a + 3;
        m.tri(a, c, d);
        m.tri(a, d, b);
    }
    // caps: fan around a centre vertex
    for &(y, ny) in [(0.5f64, 1.0f64), (-0.5, -1.0)].iter() {
        let n = [0.0, ny, 0.0];
        let centre = m.push([0.0, y, 0.0], n);
        let first = m.pos.len() as u32;
        for j in 0..dx {
            let (c, s) = rg[j];
            m.push([c, y, s], n);
        }
        for j in 0..dx as u32 {
            let a = first + j;
            let b = first + (j + 1) % dx as u32;
            if ny > 0.0 { m.tri(centre, b, a); } else { m.tri(centre, a, b); }
        }
    }
    m
}

// Unit cone along y: base radius 1 at y=+0.5 (screen-down), apex at y=-0.5.
fn mesh_cone(dx: usize) -> Mesh {
    let mut m = Mesh::new();
    let rg = ring(dx);
    // slanted side normals for r=1, h=1: (c, -1, s)/sqrt(2) — per-call scale
    // corrects them (normals are divided by the scale before renormalising).
    let k = 0.7071067811865476;
    for j in 0..=dx {
        let (c, s) = rg[j % dx];
        let n = [c * k, -k, s * k];
        m.push([c, 0.5, s], n);       // base ring
        m.push([0.0, -0.5, 0.0], n);  // apex (duplicated per segment for its normal)
    }
    for j in 0..dx as u32 {
        let a = 2 * j;
        let apex = a + 1;
        let c = a + 2;
        m.tri(a, c, apex);
    }
    // base cap (normal +y)
    let n = [0.0, 1.0, 0.0];
    let centre = m.push([0.0, 0.5, 0.0], n);
    let first = m.pos.len() as u32;
    for j in 0..dx {
        let (c, s) = rg[j];
        m.push([c, 0.5, s], n);
    }
    for j in 0..dx as u32 {
        let a = first + j;
        let b = first + (j + 1) % dx as u32;
        m.tri(centre, b, a);
    }
    m
}

// Level-of-detail ladder. p5 draws every sphere at 24x16 regardless of size;
// seaquest.v3 draws thirty spheres of 0.1-0.4 device pixels per frame, so we
// pick the tessellation from the PROJECTED radius. Deterministic (same f64
// math on every target); pixel parity with browser p5 is a non-goal.
// The last tier (3-gon rings, 6-triangle "sphere") is for objects under half
// a device pixel: they can only ever touch one pixel centre, so any closed
// solid of the right extent is as good as p5's 768-triangle one.
const SPHERE_LOD: [(usize, usize); 5] = [(24, 16), (12, 8), (8, 4), (4, 2), (3, 2)];
const RING_LOD: [usize; 5] = [24, 12, 8, 4, 3];
#[inline]
fn lod_for(r_dev: f64) -> usize {
    if r_dev >= 6.0 { 0 } else if r_dev >= 2.5 { 1 } else if r_dev >= 1.0 { 2 } else if r_dev >= 0.5 { 3 } else { 4 }
}

// ----------------------------------------------------------------- state ----
const MAX_LIGHTS: usize = 8;

#[derive(Clone, Copy)]
struct Material {
    fill: [f64; 3],        // 0..1
    ambient: [f64; 3],     // 0..1
    has_ambient: bool,     // p5 uHasSetAmbient: without it, fill doubles as ambient colour
    specular: [f64; 3],    // 0..1
    use_specular: bool,
    shininess: u32,
}

#[derive(Clone, Copy)]
struct Lights {
    ambient: [f64; 3],     // summed, 0..1 per channel
    n_dir: usize,
    dir: [([f64; 3], [f64; 3]); MAX_LIGHTS],   // (colour 0..1, UNIT direction the light travels — p5 semantics)
    n_pt: usize,
    pt: [([f64; 3], [f64; 3]); MAX_LIGHTS],    // (colour 0..1, world position)
    on: bool,              // p5 _enableLighting: any light or material call this frame
}

#[derive(Clone, Copy)]
struct Frame {
    m: M4,
    mat: Material,
    lights: Lights,
}

// A transformed vertex. Clip-space (x,y,cz,w) is filled by draw_mesh for
// every vertex; device coords (x,y overwritten, z) by project(); the colour is
// shaded LAZILY — only for vertices of triangles that survive near-clip,
// back-face culling and the empty-bbox test (most of seaquest.v3's geometry
// is sub-pixel or back-facing, and shading is the expensive per-vertex op).
#[derive(Clone, Copy, Default)]
struct SVert {
    x: f64,
    y: f64,
    z: f64,
    w: f64,   // clip w (kept for near clipping)
    cz: f64,  // clip z
    r: f64,
    g: f64,
    b: f64,
    vx: f64,  // view-space position (lighting)
    vy: f64,
    vz: f64,
    nx: f64,  // OBJECT-space normal (unit-mesh); rotated + renormalised lazily
    ny: f64,
    nz: f64,
    wnx: f64, // the same normal after rotation + renormalisation, filled by
    wny: f64, // ensure_shaded. Only the per-fragment (specular) path reads it;
    wnz: f64, // Gouraud already has the finished colour in r/g/b.
    shaded: bool,
}

// Projected vertex: device px (x,y) + NDC depth. Small, so raster_tri takes
// it by value without hauling the 120-byte SVert around.
#[derive(Clone, Copy, Default)]
struct PVert {
    x: f64,
    y: f64,
    z: f64,
}

pub struct Three {
    h: u32,
    dw: usize,
    dh: usize,
    // camera (fixed)
    eye_z: f64,
    fx: f64,   // f / aspect
    fy: f64,   // f (applied with p5's y flip)
    pz_a: f64, // clip.z = pz_a * ze + pz_b
    pz_b: f64,
    // current frame state + stack
    cur: Frame,
    stack: Vec<Frame>,
    // buffers, allocated once
    zbuf: Vec<f32>,
    xv: Vec<SVert>,
    // unit meshes
    box_m: Mesh,
    spheres: Vec<Mesh>,
    cylinders: Vec<Mesh>,
    cones: Vec<Mesh>,
}

const DEFAULT_MAT: Material = Material {
    fill: [1.0, 1.0, 1.0],
    ambient: [1.0, 1.0, 1.0],
    has_ambient: false,
    specular: [0.0, 0.0, 0.0],
    use_specular: false,
    shininess: 1,
};
const NO_LIGHTS: Lights = Lights {
    ambient: [0.0; 3],
    n_dir: 0,
    dir: [([0.0; 3], [0.0; 3]); MAX_LIGHTS],
    n_pt: 0,
    pt: [([0.0; 3], [0.0; 3]); MAX_LIGHTS],
    on: false,
};

impl Three {
    fn new(h: u32, lw: f64, lh: f64, dw: usize, dh: usize) -> Three {
        // p5 defaults: fov = PI/3 => f = 1/tan(PI/6) = sqrt(3); eyeZ = (h/2)/tan(PI/6).
        let f = 1.7320508075688772_f64;
        let eye_z = (lh / 2.0) * f;
        let aspect = lw / lh;
        let near = 0.1 * eye_z;
        let far = 10.0 * eye_z;
        let nf = 1.0 / (near - far);
        let mut spheres = Vec::new();
        let mut cylinders = Vec::new();
        let mut cones = Vec::new();
        for i in 0..SPHERE_LOD.len() {
            spheres.push(mesh_sphere(SPHERE_LOD[i].0, SPHERE_LOD[i].1));
            cylinders.push(mesh_cylinder(RING_LOD[i]));
            cones.push(mesh_cone(RING_LOD[i]));
        }
        let maxv = spheres.iter().chain(cylinders.iter()).chain(cones.iter()).map(|m| m.pos.len()).max().unwrap_or(0).max(24);
        Three {
            h,
            dw,
            dh,
            eye_z,
            fx: f / aspect,
            fy: f,
            pz_a: (far + near) * nf,
            pz_b: 2.0 * far * near * nf,
            cur: Frame { m: IDENT, mat: DEFAULT_MAT, lights: NO_LIGHTS },
            stack: Vec::with_capacity(64),
            zbuf: vec![f32::INFINITY; dw * dh],
            xv: Vec::with_capacity(maxv),
            box_m: mesh_box(),
            spheres,
            cylinders,
            cones,
        }
    }

    #[inline]
    fn touch_lighting(&mut self) {
        self.cur.lights.on = true;
    }

    // Projected radius in device pixels of a sphere of radius r at the
    // current model origin — drives LOD selection.
    #[inline]
    fn dev_radius(&self, r: f64) -> f64 {
        let ze = self.cur.m[14] - self.eye_z;
        let d = if ze < -1.0 { -ze } else { 1.0 };
        r * self.fx * (self.dw as f64) / (2.0 * d)
    }

}

// Per-vertex lighting in view space (view rotation is identity for the
// default camera; only a z shift). Returns 0..255 channels.
fn shade(m: &Material, l: &Lights, eye_z: f64, pv: [f64; 3], n: [f64; 3]) -> [f64; 3] {
    {
        if !l.on {
            return [m.fill[0] * 255.0, m.fill[1] * 255.0, m.fill[2] * 255.0];
        }
        let amb_mat = if m.has_ambient { m.ambient } else { m.fill };
        let mut diff = [0.0f64; 3];
        let mut spec = [0.0f64; 3];
        let view_dir = normalize3([-pv[0], -pv[1], -pv[2]]);
        let mut apply = |col: [f64; 3], ld: [f64; 3]| {
            // ld = UNIT direction the light travels (p5 _light: diffuse = max(0, dot(-lightDir, normal)))
            let ndl = -dot3(ld, n);
            let d = if ndl > 0.0 { ndl } else { 0.0 };
            diff[0] += col[0] * d;
            diff[1] += col[1] * d;
            diff[2] += col[2] * d;
            if m.use_specular {
                // R = reflect(ld, n) = ld - 2(n.ld)n ; phong = max(0, R.V)^shininess
                let k = 2.0 * dot3(n, ld);
                let rf = [ld[0] - k * n[0], ld[1] - k * n[1], ld[2] - k * n[2]];
                let rv = dot3(rf, view_dir);
                if rv > 0.0 {
                    let s = powi(rv, m.shininess);
                    spec[0] += col[0] * s;
                    spec[1] += col[1] * s;
                    spec[2] += col[2] * s;
                }
            }
        };
        for i in 0..l.n_dir {
            apply(l.dir[i].0, l.dir[i].1);
        }
        for i in 0..l.n_pt {
            // point light position is world space; view space = world - (0,0,eyeZ)
            let p = l.pt[i].1;
            let lp = [p[0], p[1], p[2] - eye_z];
            apply(l.pt[i].0, normalize3([pv[0] - lp[0], pv[1] - lp[1], pv[2] - lp[2]]));
        }
        let mut out = [0.0f64; 3];
        for c in 0..3 {
            let v = m.fill[c] * diff[c] + l.ambient[c] * amb_mat[c] + m.specular[c] * spec[c];
            out[c] = (if v > 1.0 { 1.0 } else { v }) * 255.0;
        }
        out
    }
}

// Viewport + projection constants handed to the free raster functions so
// they can borrow the z-buffer and scratch buffers disjointly from the meshes.
#[derive(Clone, Copy)]
struct View {
    dw: usize,
    dh: usize,
}

impl Three {
    // Whole-primitive early-out. The unit meshes all lie inside the unit
    // sphere, so the scaled mesh lies inside a sphere of radius
    // max(|sx|,|sy|,|sz|) about the model origin. If that sphere's projection,
    // padded to be conservative (perspective stretches it into an ellipse a
    // little larger than the disc at centre depth), contains no pixel centre
    // or misses the canvas, no triangle can touch a pixel and the vertex
    // transform is skipped. Exact by construction: pixel-neutral.
    // Anything crossing the near plane is left to the general path.
    #[inline]
    fn prim_may_hit(&self, sx: f64, sy: f64, sz: f64) -> bool {
        let m = &self.cur.m;
        let r = sx.abs().max(sy.abs()).max(sz.abs());
        let (cx, cy, cz) = (m[12], m[13], m[14] - self.eye_z);
        let near_w = -(cz + r);           // smallest clip w over the sphere
        if near_w <= 0.0 {
            return true;                  // touches/crosses the near plane
        }
        let iw = 1.0 / near_w;            // largest scale the sphere can get
        let pad = 1.25;
        let rx = r * self.fx * iw * pad * 0.5 * self.dw as f64;
        let ry = r * self.fy * iw * pad * 0.5 * self.dh as f64;
        // centre at its own depth (both signs of w handled by near_w > 0)
        let icw = 1.0 / (-cz);
        let px = (self.fx * cx * icw + 1.0) * 0.5 * self.dw as f64;
        let py = (1.0 - (-self.fy * cy) * icw) * 0.5 * self.dh as f64;
        let (x0, x1) = (px - rx, px + rx);
        let (y0, y1) = (py - ry, py + ry);
        if x1 < 0.0 || y1 < 0.0 || x0 > self.dw as f64 || y0 > self.dh as f64 {
            return false;                 // off canvas
        }
        // a pixel centre k+0.5 lies in [x0,x1] iff ceil(x0-0.5) <= floor(x1-0.5)
        (x0 - 0.5).ceil() <= (x1 - 0.5).floor() && (y0 - 0.5).ceil() <= (y1 - 0.5).floor()
    }

    // Draw a unit mesh scaled by (sx,sy,sz) under the current model matrix.
    // Zero allocation: xv was reserved for the largest mesh in rs_3d_begin.
    fn draw_mesh(&mut self, which: MeshRef, sx: f64, sy: f64, sz: f64) {
        if !self.prim_may_hit(sx, sy, sz) {
            return;
        }
        let mesh: &Mesh = match which {
            MeshRef::Box => &self.box_m,
            MeshRef::Sphere(i) => &self.spheres[i],
            MeshRef::Cylinder(i) => &self.cylinders[i],
            MeshRef::Cone(i) => &self.cones[i],
        };
        let xv = &mut self.xv;
        let zb = &mut self.zbuf;
        let cur = &self.cur;
        let (eye_z, fx, fy, pz_a, pz_b) = (self.eye_z, self.fx, self.fy, self.pz_a, self.pz_b);
        let view = View { dw: self.dw, dh: self.dh };
        let px = &mut crate::cv(self.h).px;
        let m = cur.m;
        let isx = if sx != 0.0 { 1.0 / sx } else { 0.0 };
        let isy = if sy != 0.0 { 1.0 / sy } else { 0.0 };
        let isz = if sz != 0.0 { 1.0 / sz } else { 0.0 };
        xv.clear();
        debug_assert!(xv.capacity() >= mesh.pos.len());
        for (p, n) in mesh.pos.iter().zip(mesh.nrm.iter()) {
            let (qx, qy, qz) = (p[0] * sx, p[1] * sy, p[2] * sz);
            // view-space position (model then camera z shift)
            let vx = m[0] * qx + m[4] * qy + m[8] * qz + m[12];
            let vy = m[1] * qx + m[5] * qy + m[9] * qz + m[13];
            let vz = m[2] * qx + m[6] * qy + m[10] * qz + m[14] - eye_z;
            // clip space (p5 projection incl. the y flip)
            let cx = fx * vx;
            let cy = -fy * vy;
            let cz = pz_a * vz + pz_b;
            let cw = -vz;
            xv.push(SVert {
                x: cx, y: cy, z: 0.0, w: cw, cz, r: 0.0, g: 0.0, b: 0.0,
                vx, vy, vz, nx: n[0], ny: n[1], nz: n[2],
                wnx: 0.0, wny: 0.0, wnz: 0.0, shaded: false,
            });
        }
        // Lazy per-vertex shading: rotate + renormalise the object normal
        // (inverse-transpose of rigid*scale = rotation * (n / scale)), light it.
        let ensure_shaded = |xv: &mut Vec<SVert>, i: usize| {
            if xv[i].shaded {
                return;
            }
            let v = xv[i];
            let (nx, ny, nz) = (v.nx * isx, v.ny * isy, v.nz * isz);
            let nn = normalize3([
                m[0] * nx + m[4] * ny + m[8] * nz,
                m[1] * nx + m[5] * ny + m[9] * nz,
                m[2] * nx + m[6] * ny + m[10] * nz,
            ]);
            let col = shade(&cur.mat, &cur.lights, eye_z, [v.vx, v.vy, v.vz], nn);
            let v = &mut xv[i];
            v.r = col[0];
            v.g = col[1];
            v.b = col[2];
            v.wnx = nn[0];
            v.wny = nn[1];
            v.wnz = nn[2];
            v.shaded = true;
        };
        for t in mesh.idx.iter() {
            let (ia, ib, ic) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let inside = |v: &SVert| v.cz + v.w >= 0.0;
            if inside(&xv[ia]) && inside(&xv[ib]) && inside(&xv[ic]) {
                // Common case: project, cull, bbox-test BEFORE paying for shading.
                let pv = [project(view, &xv[ia]), project(view, &xv[ib]), project(view, &xv[ic])];
                if !tri_visible(view, &pv) {
                    continue;
                }
                ensure_shaded(xv, ia);
                ensure_shaded(xv, ib);
                ensure_shaded(xv, ic);
                let col = |i: usize| [xv[i].r, xv[i].g, xv[i].b];
                let vpos = |i: usize| [xv[i].vx, xv[i].vy, xv[i].vz];
                let nrm = |i: usize| [xv[i].wnx, xv[i].wny, xv[i].wnz];
                let shading = if cur.mat.use_specular && cur.lights.on {
                    Shading::Phong {
                        vp: [vpos(ia), vpos(ib), vpos(ic)],
                        nr: [nrm(ia), nrm(ib), nrm(ic)],
                        mat: &cur.mat,
                        lights: &cur.lights,
                        eye_z,
                    }
                } else {
                    Shading::Gouraud(&[col(ia), col(ib), col(ic)])
                };
                raster_tri(view, px, zb, &pv, &shading);
            } else {
                // Rare (near-plane straddle): shade all three, then clip.
                ensure_shaded(xv, ia);
                ensure_shaded(xv, ib);
                ensure_shaded(xv, ic);
                clip_and_raster(view, px, zb, xv[ia], xv[ib], xv[ic]);
            }
        }
    }
}

// Perspective divide + viewport map for one clip-space vertex.
#[inline]
fn project(view: View, v: &SVert) -> PVert {
    let iw = 1.0 / v.w;
    let nx = v.x * iw;
    let ny = v.y * iw;
    PVert { x: (nx + 1.0) * 0.5 * view.dw as f64, y: (1.0 - ny) * 0.5 * view.dh as f64, z: v.cz * iw }
}

// The same orientation + bbox tests raster_tri applies, without the raster.
#[inline]
fn tri_visible(view: View, p: &[PVert; 3]) -> bool {
    #[inline]
    fn fx(v: f64) -> i64 {
        (v * 16.0).round() as i64
    }
    let (a, b, c) = (&p[0], &p[1], &p[2]);
    let (x0, y0, x1, y1, x2, y2) = (fx(a.x), fx(a.y), fx(b.x), fx(b.y), fx(c.x), fx(c.y));
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if area <= 0 {
        return false;
    }
    let minx = (x0.min(x1).min(x2) >> 4).max(0);
    let maxx = ((x0.max(x1).max(x2) + 15) >> 4).min(view.dw as i64 - 1);
    let miny = (y0.min(y1).min(y2) >> 4).max(0);
    let maxy = ((y0.max(y1).max(y2) + 15) >> 4).min(view.dh as i64 - 1);
    minx <= maxx && miny <= maxy
}

// Near-plane clip (z_clip + w_clip >= 0) in clip space, then perspective
// divide, viewport map and raster. Fixed-size scratch; no allocation.
fn clip_and_raster(view: View, px: &mut [u8], zb: &mut [f32], a: SVert, b: SVert, c: SVert) {
    {
        let inside = |v: &SVert| v.cz + v.w >= 0.0;
        let ins = [inside(&a), inside(&b), inside(&c)];
        let n_in = ins.iter().filter(|&&x| x).count();
        if n_in == 0 {
            return;
        }
        let mut out: [SVert; 4] = [SVert::default(); 4];
        let mut n_out = 0usize;
        if n_in == 3 {
            out[0] = a;
            out[1] = b;
            out[2] = c;
            n_out = 3;
        } else {
            let vs = [a, b, c];
            for i in 0..3 {
                let cur = vs[i];
                let nxt = vs[(i + 1) % 3];
                let ci = ins[i];
                let ni = ins[(i + 1) % 3];
                if ci {
                    out[n_out] = cur;
                    n_out += 1;
                }
                if ci != ni {
                    let da = cur.cz + cur.w;
                    let db = nxt.cz + nxt.w;
                    let t = da / (da - db);
                    let l = |p: f64, q: f64| p + (q - p) * t;
                    out[n_out] = SVert {
                        x: l(cur.x, nxt.x),
                        y: l(cur.y, nxt.y),
                        z: 0.0,
                        w: l(cur.w, nxt.w),
                        cz: l(cur.cz, nxt.cz),
                        r: l(cur.r, nxt.r),
                        g: l(cur.g, nxt.g),
                        b: l(cur.b, nxt.b),
                        ..cur
                    };
                    n_out += 1;
                }
            }
        }
        // perspective divide + viewport
        let mut pv = [PVert::default(); 4];
        let mut cl = [[0.0f64; 3]; 4];
        for i in 0..n_out {
            pv[i] = project(view, &out[i]);
            cl[i] = [out[i].r, out[i].g, out[i].b];
        }
        raster_tri(view, px, zb, &[pv[0], pv[1], pv[2]], &Shading::Gouraud(&[cl[0], cl[1], cl[2]]));
        if n_out == 4 {
            raster_tri(view, px, zb, &[pv[0], pv[2], pv[3]], &Shading::Gouraud(&[cl[0], cl[2], cl[3]]));
        }
    }
}

// Fixed-point (28.4) edge-function rasterizer with the top-left fill rule,
// back-face culling, LEQUAL depth test (p5's depthFunc), Gouraud colour.
// Each row visits ONLY the pixels inside all three edges: the inside set
// {k : E_i(k) + bias_i >= 0} is an integer interval per edge (E is affine in
// k), so the row's span is their intersection — exact integer arithmetic, the
// identical pixel set the per-pixel test would select, no wasted work on the
// bbox of a thin or slanted triangle.
// How a triangle gets its colour. Gouraud is the default and what every gate
// scene used before: one shade() per vertex, interpolated across the span.
// Phong shades PER PIXEL, and exists because Gouraud structurally cannot show a
// specular highlight that lands inside a triangle rather than on a vertex --
// which is what made specularMaterial() geometry (seaquest.v3's fish and subs)
// look flat next to real p5. It is selected only when the material actually has
// specular on, so diffuse-only geometry keeps the cheap path and its hashes.
enum Shading<'a> {
    Gouraud(&'a [[f64; 3]; 3]),
    Phong {
        vp: [[f64; 3]; 3],
        nr: [[f64; 3]; 3],
        mat: &'a Material,
        lights: &'a Lights,
        eye_z: f64,
    },
}

fn raster_tri(view: View, px: &mut [u8], zb: &mut [f32], p: &[PVert; 3], shading: &Shading) {
    #[inline]
    fn fx(v: f64) -> i64 {
        (v * 16.0).round() as i64
    }
    let (v0, v1, v2) = (&p[0], &p[1], &p[2]);
    let (x0, y0) = (fx(v0.x), fx(v0.y));
    let (x1, y1) = (fx(v1.x), fx(v1.y));
    let (x2, y2) = (fx(v2.x), fx(v2.y));
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    // Outward CCW faces come out with POSITIVE area in device space: p5's
    // y flip in the projection and the viewport's y-down mapping cancel,
    // so device y grows with world y. Cull back faces and degenerates.
    if area <= 0 {
        return;
    }
    let dw = view.dw as i64;
    let dh = view.dh as i64;
    let minx = (x0.min(x1).min(x2) >> 4).max(0);
    let maxx = ((x0.max(x1).max(x2) + 15) >> 4).min(dw - 1);
    let miny = (y0.min(y1).min(y2) >> 4).max(0);
    let maxy = ((y0.max(y1).max(y2) + 15) >> 4).min(dh - 1);
    if minx > maxx || miny > maxy {
        return;
    }
    // edge i: from v_i to v_{i+1}; E(p) = dx*(py-ay) - dy*(px-ax)
    let ex = [x1 - x0, x2 - x1, x0 - x2];
    let ey = [y1 - y0, y2 - y1, y0 - y2];
    let ax = [x0, x1, x2];
    let ay = [y0, y1, y2];
    let bias = |i: usize| -> i64 { if ey[i] < 0 || (ey[i] == 0 && ex[i] > 0) { 0 } else { -1 } };
    let bias = [bias(0), bias(1), bias(2)];
    let px0 = (minx << 4) + 8;
    let py0 = (miny << 4) + 8;
    let mut row = [0i64; 3];
    for i in 0..3 {
        row[i] = ex[i] * (py0 - ay[i]) - ey[i] * (px0 - ax[i]) + bias[i];
    }
    let stepx = [-ey[0] * 16, -ey[1] * 16, -ey[2] * 16];
    let stepy = [ex[0] * 16, ex[1] * 16, ex[2] * 16];
    let inv_area = 1.0 / area as f64;
    let w = view.dw;
    let n = maxx - minx;   // k in 0..=n
    let (c0, c1, c2) = match shading {
        Shading::Gouraud(col) => (col[0], col[1], col[2]),
        // unused by the Phong arm; keeps the flat test below a single compare
        Shading::Phong { .. } => ([0.0; 3], [1.0; 3], [2.0; 3]),
    };
    let flat = c0 == c1 && c1 == c2;
    let (fr, fg, fb) = (clamp_u8(c0[0]), clamp_u8(c0[1]), clamp_u8(c0[2]));
    for y in miny..=maxy {
        // intersect the three half-line constraints on k
        let mut klo: i64 = 0;
        let mut khi: i64 = n;
        for i in 0..3 {
            let r = row[i];
            let st = stepx[i];
            if st == 0 {
                if r < 0 { khi = -1; break; }
            } else if st > 0 {
                // r + k*st >= 0  =>  k >= ceil(-r / st)
                let k = -((r).div_euclid(st));
                if k > klo { klo = k; }
            } else {
                // r + k*st >= 0  =>  k <= floor(r / -st)
                let k = r.div_euclid(-st);
                if k < khi { khi = k; }
            }
        }
        if klo <= khi {
            let base = (y as usize) * w + (minx + klo) as usize;
            let n_px = (khi - klo + 1) as usize;
            let zrow = &mut zb[base..base + n_px];
            let prow = &mut px[base * 4..(base + n_px) * 4];
            // edge values walk incrementally in exact integer arithmetic (the
            // bias is removed: it only steers the inclusion test)
            let mut e0 = row[0] + klo * stepx[0] - bias[0];
            let mut e1 = row[1] + klo * stepx[1] - bias[1];
            let mut e2 = row[2] + klo * stepx[2] - bias[2];
            if flat {
                // Flat-colour fast path: all three vertices carry the same
                // colour, so interpolation is skipped (a box face under
                // directional light only; the common case for large quads).
                for i in 0..n_px {
                    let w0 = e1 as f64 * inv_area;
                    let w1 = e2 as f64 * inv_area;
                    let w2 = e0 as f64 * inv_area;
                    let z = (w0 * v0.z + w1 * v1.z + w2 * v2.z) as f32;
                    if z <= zrow[i] {
                        zrow[i] = z;
                        let q = i * 4;
                        prow[q] = fr;
                        prow[q + 1] = fg;
                        prow[q + 2] = fb;
                        prow[q + 3] = 255;
                    }
                    e0 += stepx[0];
                    e1 += stepx[1];
                    e2 += stepx[2];
                }
            } else if let Shading::Phong { vp, nr, mat, lights, eye_z } = shading {
                // Per-fragment: interpolate the view position and the normal,
                // renormalise, and light THIS pixel. Interpolation is affine in
                // screen space like the z above, not perspective-correct; on the
                // small, near-planar triangles these meshes produce the error is
                // far below the highlight it recovers, and it keeps the edge walk
                // exactly as gated.
                for i in 0..n_px {
                    let w0 = e1 as f64 * inv_area;
                    let w1 = e2 as f64 * inv_area;
                    let w2 = e0 as f64 * inv_area;
                    let z = (w0 * v0.z + w1 * v1.z + w2 * v2.z) as f32;
                    if z <= zrow[i] {
                        zrow[i] = z;
                        let pv = [
                            w0 * vp[0][0] + w1 * vp[1][0] + w2 * vp[2][0],
                            w0 * vp[0][1] + w1 * vp[1][1] + w2 * vp[2][1],
                            w0 * vp[0][2] + w1 * vp[1][2] + w2 * vp[2][2],
                        ];
                        let n = normalize3([
                            w0 * nr[0][0] + w1 * nr[1][0] + w2 * nr[2][0],
                            w0 * nr[0][1] + w1 * nr[1][1] + w2 * nr[2][1],
                            w0 * nr[0][2] + w1 * nr[1][2] + w2 * nr[2][2],
                        ]);
                        let c = shade(mat, lights, *eye_z, pv, n);
                        let q = i * 4;
                        prow[q] = clamp_u8(c[0]);
                        prow[q + 1] = clamp_u8(c[1]);
                        prow[q + 2] = clamp_u8(c[2]);
                        prow[q + 3] = 255;
                    }
                    e0 += stepx[0];
                    e1 += stepx[1];
                    e2 += stepx[2];
                }
            } else {
                for i in 0..n_px {
                    // weights: w0 from edge 1 (v1->v2), w1 from edge 2, w2 from edge 0
                    let w0 = e1 as f64 * inv_area;
                    let w1 = e2 as f64 * inv_area;
                    let w2 = e0 as f64 * inv_area;
                    let z = (w0 * v0.z + w1 * v1.z + w2 * v2.z) as f32;
                    if z <= zrow[i] {
                        zrow[i] = z;
                        let r = w0 * c0[0] + w1 * c1[0] + w2 * c2[0];
                        let g = w0 * c0[1] + w1 * c1[1] + w2 * c2[1];
                        let b = w0 * c0[2] + w1 * c1[2] + w2 * c2[2];
                        let q = i * 4;
                        prow[q] = clamp_u8(r);
                        prow[q + 1] = clamp_u8(g);
                        prow[q + 2] = clamp_u8(b);
                        prow[q + 3] = 255;
                    }
                    e0 += stepx[0];
                    e1 += stepx[1];
                    e2 += stepx[2];
                }
            }
        }
        row[0] += stepy[0];
        row[1] += stepy[1];
        row[2] += stepy[2];
    }
}

#[derive(Clone, Copy)]
enum MeshRef {
    Box,
    Sphere(usize),
    Cylinder(usize),
    Cone(usize),
}

// ------------------------------------------------------------ accessors ----
#[inline]
fn t3() -> Option<&'static mut Three> {
    rs().three.as_deref_mut()
}
#[inline]
fn c01(v: f64) -> f64 {
    let x = v / 255.0;
    if x < 0.0 { 0.0 } else if x > 1.0 { 1.0 } else { x }
}

// ------------------------------------------------------------------ ABI ----

/// Switch canvas `h` (logical lw x lh) into WEBGL mode. Allocates the z-buffer
/// and tessellation caches; the state's dirty-rect record/replay is disabled
/// (3D ops are not recorded and would reorder against 2D ones).
#[no_mangle]
pub extern "C" fn rs_3d_begin(h: u32, lw: f64, lh: f64) {
    let (dw, dh) = {
        let c: &Canvas = crate::cv(h);
        (c.dw, c.dh)
    };
    let s = rs();
    s.dirty = false;
    s.recording = false;
    s.has_last = false;
    s.three = Some(Box::new(Three::new(h, lw, lh, dw, dh)));
}

/// Start of a draw(): p5 resets the model matrix and clears the light list
/// each frame. Materials and fill persist (style state).
#[no_mangle]
pub extern "C" fn rs_3d_frame_begin() {
    if let Some(t) = t3() {
        t.cur.m = IDENT;
        t.cur.lights = NO_LIGHTS;
        t.stack.clear();
    }
}

/// End of a draw(). Reserved hook (nothing to flush today).
#[no_mangle]
pub extern "C" fn rs_3d_frame_end() {}

/// background() in WEBGL mode also clears the depth buffer.
#[no_mangle]
pub extern "C" fn rs_3d_clear_depth() {
    if let Some(t) = t3() {
        for z in t.zbuf.iter_mut() {
            *z = f32::INFINITY;
        }
    }
}

#[no_mangle]
pub extern "C" fn rs_3d_push() {
    if let Some(t) = t3() {
        let f = t.cur;
        t.stack.push(f);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_pop() {
    if let Some(t) = t3() {
        if let Some(f) = t.stack.pop() {
            t.cur = f;
        }
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_translate(x: f64, y: f64, z: f64) {
    if let Some(t) = t3() {
        m_translate(&mut t.cur.m, x, y, z);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_rotate_x(a: f64) {
    if let Some(t) = t3() {
        m_rotate_x(&mut t.cur.m, a);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_rotate_y(a: f64) {
    if let Some(t) = t3() {
        m_rotate_y(&mut t.cur.m, a);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_rotate_z(a: f64) {
    if let Some(t) = t3() {
        m_rotate_z(&mut t.cur.m, a);
    }
}

// Colours arrive pre-rounded 0..255 from the p5 layer's colorArgs pipeline.
#[no_mangle]
pub extern "C" fn rs_3d_fill(r: f64, g: f64, b: f64) {
    if let Some(t) = t3() {
        t.cur.mat.fill = [c01(r), c01(g), c01(b)];
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_ambient_material(r: f64, g: f64, b: f64) {
    if let Some(t) = t3() {
        t.cur.mat.ambient = [c01(r), c01(g), c01(b)];
        t.cur.mat.has_ambient = true;
        t.touch_lighting();
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_specular_material(r: f64, g: f64, b: f64) {
    if let Some(t) = t3() {
        t.cur.mat.specular = [c01(r), c01(g), c01(b)];
        t.cur.mat.use_specular = true;
        t.touch_lighting();
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_shininess(s: f64) {
    if let Some(t) = t3() {
        let v = if s.is_finite() { s.round() } else { 1.0 };
        t.cur.mat.shininess = if v < 1.0 { 1 } else if v > 1024.0 { 1024 } else { v as u32 };
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_ambient_light(r: f64, g: f64, b: f64) {
    if let Some(t) = t3() {
        let l = &mut t.cur.lights;
        l.ambient[0] += c01(r);
        l.ambient[1] += c01(g);
        l.ambient[2] += c01(b);
        l.on = true;
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_directional_light(r: f64, g: f64, b: f64, x: f64, y: f64, z: f64) {
    if let Some(t) = t3() {
        let l = &mut t.cur.lights;
        l.on = true;
        if l.n_dir < MAX_LIGHTS {
            // normalised once here; shade() would otherwise redo it per vertex
            l.dir[l.n_dir] = ([c01(r), c01(g), c01(b)], normalize3([x, y, z]));
            l.n_dir += 1;
        }
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_point_light(r: f64, g: f64, b: f64, x: f64, y: f64, z: f64) {
    if let Some(t) = t3() {
        let l = &mut t.cur.lights;
        l.on = true;
        if l.n_pt < MAX_LIGHTS {
            l.pt[l.n_pt] = ([c01(r), c01(g), c01(b)], [x, y, z]);
            l.n_pt += 1;
        }
    }
}

#[no_mangle]
pub extern "C" fn rs_3d_box(w: f64, h: f64, d: f64) {
    if let Some(t) = t3() {
        t.draw_mesh(MeshRef::Box, w, h, d);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_sphere(r: f64) {
    rs_3d_ellipsoid(r, r, r);
}
#[no_mangle]
pub extern "C" fn rs_3d_ellipsoid(rx: f64, ry: f64, rz: f64) {
    if let Some(t) = t3() {
        let l = lod_for(t.dev_radius(rx.max(ry).max(rz)));
        t.draw_mesh(MeshRef::Sphere(l), rx, ry, rz);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_cylinder(r: f64, h: f64) {
    if let Some(t) = t3() {
        let l = lod_for(t.dev_radius(r));
        t.draw_mesh(MeshRef::Cylinder(l), r, h, r);
    }
}
#[no_mangle]
pub extern "C" fn rs_3d_cone(r: f64, h: f64) {
    if let Some(t) = t3() {
        let l = lod_for(t.dev_radius(r));
        t.draw_mesh(MeshRef::Cone(l), r, h, r);
    }
}

/// 1 if the active state is in WEBGL mode.
#[no_mangle]
pub extern "C" fn rs_3d_active() -> i32 {
    if rs().three.is_some() { 1 } else { 0 }
}

// ---------------------------------------------------------------- tests ----
// Golden-hash tests. Scenes are expressed as an op list so the SAME script
// can be replayed against the wasm32 build (tests/wasm_three_check.mjs reads
// the JSON this module writes when THREE_SCENES_OUT is set) — that is the
// cross-target gate of plan task 3. THREE_DUMP_DIR=<dir> writes a BMP per
// scene for eyeballing.
#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    enum Op {
        Bg(f64, f64, f64),
        Push,
        Pop,
        Tr(f64, f64, f64),
        Rx(f64),
        Ry(f64),
        Rz(f64),
        Fill(f64, f64, f64),
        Amb(f64, f64, f64),
        Spec(f64, f64, f64),
        Shin(f64),
        AL(f64, f64, f64),
        DL(f64, f64, f64, f64, f64, f64),
        PL(f64, f64, f64, f64, f64, f64),
        Box3(f64, f64, f64),
        Sph(f64),
        Ell(f64, f64, f64),
        Cyl(f64, f64),
        Cone(f64, f64),
    }

    fn op_json(o: &Op) -> String {
        match o {
            Op::Bg(r, g, b) => format!("[\"bg\",{},{},{}]", r, g, b),
            Op::Push => "[\"push\"]".into(),
            Op::Pop => "[\"pop\"]".into(),
            Op::Tr(x, y, z) => format!("[\"tr\",{},{},{}]", x, y, z),
            Op::Rx(a) => format!("[\"rx\",{}]", a),
            Op::Ry(a) => format!("[\"ry\",{}]", a),
            Op::Rz(a) => format!("[\"rz\",{}]", a),
            Op::Fill(r, g, b) => format!("[\"fill\",{},{},{}]", r, g, b),
            Op::Amb(r, g, b) => format!("[\"amb\",{},{},{}]", r, g, b),
            Op::Spec(r, g, b) => format!("[\"spec\",{},{},{}]", r, g, b),
            Op::Shin(s) => format!("[\"shin\",{}]", s),
            Op::AL(r, g, b) => format!("[\"al\",{},{},{}]", r, g, b),
            Op::DL(r, g, b, x, y, z) => format!("[\"dl\",{},{},{},{},{},{}]", r, g, b, x, y, z),
            Op::PL(r, g, b, x, y, z) => format!("[\"pl\",{},{},{},{},{},{}]", r, g, b, x, y, z),
            Op::Box3(w, h, d) => format!("[\"box\",{},{},{}]", w, h, d),
            Op::Sph(r) => format!("[\"sph\",{}]", r),
            Op::Ell(x, y, z) => format!("[\"ell\",{},{},{}]", x, y, z),
            Op::Cyl(r, h) => format!("[\"cyl\",{},{}]", r, h),
            Op::Cone(r, h) => format!("[\"cone\",{},{}]", r, h),
        }
    }

    // Mirrors what p5.cpp does per call in WEBGL mode (background = 2D fill
    // of the whole canvas + depth clear).
    fn run(h: u32, ops: &[Op]) {
        for o in ops {
            match *o {
                Op::Bg(r, g, b) => {
                    crate::rs_save(h);
                    crate::rs_reset_transform(h);
                    crate::rs_set_fill(h, r, g, b, 255.0);
                    crate::rs_fill_rect(h, 0.0, 0.0, 400.0, 400.0);
                    crate::rs_restore(h);
                    rs_3d_clear_depth();
                }
                Op::Push => rs_3d_push(),
                Op::Pop => rs_3d_pop(),
                Op::Tr(x, y, z) => rs_3d_translate(x, y, z),
                Op::Rx(a) => rs_3d_rotate_x(a),
                Op::Ry(a) => rs_3d_rotate_y(a),
                Op::Rz(a) => rs_3d_rotate_z(a),
                Op::Fill(r, g, b) => rs_3d_fill(r, g, b),
                Op::Amb(r, g, b) => rs_3d_ambient_material(r, g, b),
                Op::Spec(r, g, b) => rs_3d_specular_material(r, g, b),
                Op::Shin(s) => rs_3d_shininess(s),
                Op::AL(r, g, b) => rs_3d_ambient_light(r, g, b),
                Op::DL(r, g, b, x, y, z) => rs_3d_directional_light(r, g, b, x, y, z),
                Op::PL(r, g, b, x, y, z) => rs_3d_point_light(r, g, b, x, y, z),
                Op::Box3(w, hh, d) => rs_3d_box(w, hh, d),
                Op::Sph(r) => rs_3d_sphere(r),
                Op::Ell(x, y, z) => rs_3d_ellipsoid(x, y, z),
                Op::Cyl(r, hh) => rs_3d_cylinder(r, hh),
                Op::Cone(r, hh) => rs_3d_cone(r, hh),
            }
        }
    }

    fn fnv(px: &[u8]) -> u64 {
        let mut h: u64 = 1469598103934665603;
        for &b in px {
            h ^= b as u64;
            h = h.wrapping_mul(1099511628211);
        }
        h
    }

    fn dump_bmp(path: &str, w: usize, hh: usize, px: &[u8]) {
        let row = (w * 3 + 3) & !3;
        let size = 54 + row * hh;
        let mut b: Vec<u8> = Vec::with_capacity(size);
        b.extend_from_slice(b"BM");
        b.extend_from_slice(&(size as u32).to_le_bytes());
        b.extend_from_slice(&[0, 0, 0, 0]);
        b.extend_from_slice(&54u32.to_le_bytes());
        b.extend_from_slice(&40u32.to_le_bytes());
        b.extend_from_slice(&(w as i32).to_le_bytes());
        b.extend_from_slice(&(hh as i32).to_le_bytes());
        b.extend_from_slice(&1u16.to_le_bytes());
        b.extend_from_slice(&24u16.to_le_bytes());
        b.extend_from_slice(&[0u8; 24]);
        for y in (0..hh).rev() {
            for x in 0..w {
                let o = (y * w + x) * 4;
                b.push(px[o + 2]);
                b.push(px[o + 1]);
                b.push(px[o]);
            }
            for _ in 0..(row - w * 3) {
                b.push(0);
            }
        }
        std::fs::write(path, b).unwrap();
    }

    // Fresh per-test state (tests run on several threads; each thread gets a
    // lazily created default RState, but an explicit one keeps handles at 0).
    fn fresh() -> u32 {
        let st = crate::rs_state_new();
        crate::rs_state_select(st);
        let h = crate::rs_new_canvas(400.0, 400.0, 64.0, 64.0);
        rs_3d_begin(h, 400.0, 400.0);
        rs_3d_frame_begin();
        h
    }

    fn scene_hash(name: &str, ops: &[Op]) -> u64 {
        let h = fresh();
        run(h, ops);
        let px = &crate::cv(h).px;
        if let Ok(d) = std::env::var("THREE_DUMP_DIR") {
            dump_bmp(&format!("{}/{}.bmp", d, name), 64, 64, px);
        }
        if let Ok(p) = std::env::var("THREE_SCENES_OUT") {
            let line = format!(
                "{{\"name\":\"{}\",\"hash\":\"{}\",\"ops\":[{}]}}\n",
                name,
                fnv(px),
                ops.iter().map(op_json).collect::<Vec<_>>().join(",")
            );
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap();
            f.write_all(line.as_bytes()).unwrap();
        }
        fnv(px)
    }

    #[test]
    fn trig_is_sane() {
        let pi = core::f64::consts::PI;
        assert!(sincos(0.0) == (0.0, 1.0));
        assert!(sincos(pi).0.abs() < 1e-15 && (sincos(pi).1 + 1.0).abs() < 1e-15);
        assert!((sincos(pi / 2.0).0 - 1.0).abs() < 1e-15);
        assert!((sincos(-pi / 2.0).1).abs() < 1e-15);
        for i in 0..1000 {
            let x = (i as f64 - 500.0) * 0.037;
            let (s, c) = sincos(x);
            assert!((s * s + c * c - 1.0).abs() < 1e-14, "x={}", x);
            assert!((s - x.sin()).abs() < 1e-12 && (c - x.cos()).abs() < 1e-12, "x={}", x);
        }
    }

    // One lit box, light travelling away from the viewer (hits +z faces).
    // Pins: front face is the fill colour at full diffuse (so the winding /
    // culling is right — a back face would be black), corners are background.
    #[test]
    fn lit_box_front_face() {
        let ops = [
            Op::Bg(0.0, 0.0, 0.0),
            Op::DL(255.0, 255.0, 255.0, 0.0, 0.0, -1.0),
            Op::Fill(200.0, 100.0, 50.0),
            Op::Box3(100.0, 100.0, 100.0),
        ];
        let h = fresh();
        run(h, &ops);
        let px = &crate::cv(h).px;
        let c = (32 * 64 + 32) * 4;
        assert_eq!(&px[c..c + 3], &[200, 100, 50], "front face should be fully lit fill");
        assert_eq!(&px[0..3], &[0, 0, 0]);
        // 100 logical units at eyeZ=346 project to ~ 100/400*64*(346/(346-50)) ≈ 18.7 px
        let mut lit = 0;
        for i in 0..64 * 64 {
            if px[i * 4] > 0 { lit += 1; }
        }
        assert!(lit > 250 && lit < 450, "lit pixel count {}", lit);
    }

    // The three canonical hashes. Recorded 2026-09-07 on aarch64-apple-darwin
    // (rustc 1.98 native) and matched by the wasm32 build the same day.
    #[test]
    fn golden_one_tri_like_box() {
        let ops = [
            Op::Bg(0.0, 0.0, 0.0),
            Op::DL(255.0, 255.0, 255.0, 0.0, 0.0, -1.0),
            Op::Fill(200.0, 100.0, 50.0),
            Op::Box3(100.0, 100.0, 100.0),
        ];
        let hh = scene_hash("box_front", &ops);
        assert_eq!(hh, GOLD_BOX, "box_front hash {}", hh);
    }

    #[test]
    fn golden_lit_rotated_box() {
        let ops = [
            Op::Bg(10.0, 30.0, 60.0),
            Op::AL(40.0, 80.0, 120.0),
            Op::DL(200.0, 240.0, 255.0, 0.5, 1.0, -0.5),
            Op::Fill(160.0, 140.0, 100.0),
            Op::Amb(160.0, 140.0, 100.0),
            Op::Push,
            Op::Ry(0.6),
            Op::Rx(0.4),
            Op::Box3(150.0, 100.0, 120.0),
            Op::Pop,
        ];
        let hh = scene_hash("box_rot", &ops);
        assert_eq!(hh, GOLD_ROT, "box_rot hash {}", hh);
    }

    // A seaquest.v3-like frame composed by hand: the game's light rig, floor,
    // surface, seaweed cylinders, a sub (cylinder+sphere+cone+box), bubbles.
    fn seaquest_ops() -> Vec<Op> {
        let mut ops = vec![
            Op::Bg(10.0, 30.0, 60.0),
            Op::Push,
            Op::Tr(-200.0, -200.0, 0.0),
            Op::AL(40.0, 80.0, 120.0),
            Op::DL(200.0, 240.0, 255.0, 0.5, 1.0, -0.5),
            Op::PL(0.0, 255.0, 255.0, 200.0, 200.0, 100.0),
            // floor
            Op::Push, Op::Tr(200.0, 400.0, -20.0), Op::Fill(160.0, 140.0, 100.0), Op::Amb(160.0, 140.0, 100.0), Op::Box3(600.0, 40.0, 100.0), Op::Pop,
            // surface
            Op::Push, Op::Fill(0.0, 120.0, 200.0), Op::Amb(0.0, 120.0, 200.0), Op::Tr(200.0, 35.0, -10.0), Op::Box3(600.0, 70.0, 40.0), Op::Pop,
            // seaweed
            Op::Fill(34.0, 139.0, 34.0), Op::Amb(34.0, 139.0, 34.0),
        ];
        for i in 0..6 {
            let x = 30.0 + 60.0 * i as f64;
            let hgt = 30.0 + 7.0 * i as f64;
            ops.extend_from_slice(&[Op::Push, Op::Tr(x, 400.0 - hgt / 2.0, -10.0), Op::Rz(0.05 * i as f64), Op::Cyl(3.0, hgt), Op::Pop]);
        }
        // background fish (ellipsoid + tail)
        ops.extend_from_slice(&[
            Op::Push, Op::Tr(120.0, 150.0, -50.0), Op::Ry(core::f64::consts::PI), Op::Fill(90.0, 120.0, 200.0), Op::Amb(90.0, 120.0, 200.0),
            Op::Ell(8.0, 4.0, 2.0), Op::Tr(-6.0, 0.0, 0.0), Op::Box3(2.0, 6.0, 1.0), Op::Pop,
        ]);
        // bubbles
        ops.extend_from_slice(&[Op::Fill(60.0, 110.0, 160.0), Op::Amb(60.0, 110.0, 160.0)]);
        for i in 0..10 {
            ops.extend_from_slice(&[Op::Push, Op::Tr(20.0 + 37.0 * i as f64, 90.0 + 23.0 * i as f64, -10.0 + i as f64), Op::Sph(1.5), Op::Pop]);
        }
        // oxygen bar
        ops.extend_from_slice(&[
            Op::Push, Op::Fill(20.0, 20.0, 20.0), Op::Amb(20.0, 20.0, 20.0), Op::Tr(200.0, 390.0, 5.0), Op::Box3(380.0, 10.0, 5.0), Op::Pop,
            Op::Push, Op::Fill(0.0, 255.0, 255.0), Op::Amb(0.0, 255.0, 255.0), Op::Tr(10.0 + 140.0, 390.0, 6.0), Op::Box3(280.0, 8.0, 6.0), Op::Pop,
        ]);
        // player sub facing +x at (200,200)
        ops.extend_from_slice(&[
            Op::Push, Op::Tr(200.0, 200.0, 0.0), Op::Ry(0.0),
            Op::Fill(255.0, 220.0, 0.0), Op::Spec(255.0, 220.0, 0.0), Op::Shin(40.0),
            Op::Push, Op::Rz(1.5707963267948966), Op::Cyl(7.0, 16.0), Op::Pop,
            Op::Push, Op::Tr(8.0, 0.0, 0.0), Op::Sph(7.0), Op::Pop,
            Op::Push, Op::Tr(-8.0, 0.0, 0.0), Op::Rz(-1.5707963267948966), Op::Cone(7.0, 8.0), Op::Pop,
            Op::Push, Op::Tr(0.0, -9.0, 0.0), Op::Box3(2.0, 4.0, 2.0), Op::Tr(2.0, -2.0, 0.0), Op::Box3(4.0, 2.0, 2.0), Op::Pop,
            Op::Pop,
            // an enemy sub facing -x
            Op::Push, Op::Tr(80.0, 260.0, 0.0), Op::Ry(core::f64::consts::PI),
            Op::Fill(220.0, 50.0, 50.0), Op::Spec(220.0, 50.0, 50.0), Op::Shin(30.0),
            Op::Push, Op::Rz(1.5707963267948966), Op::Cyl(6.0, 14.0), Op::Pop,
            Op::Push, Op::Tr(7.0, 0.0, 0.0), Op::Sph(6.0), Op::Pop,
            Op::Push, Op::Tr(-7.0, 0.0, 0.0), Op::Rz(-1.5707963267948966), Op::Cone(6.0, 6.0), Op::Pop,
            Op::Pop,
            // a shark: ellipsoid + dorsal cone + tail box
            Op::Push, Op::Tr(300.0, 300.0, 0.0), Op::Fill(100.0, 130.0, 160.0), Op::Spec(100.0, 130.0, 160.0), Op::Shin(10.0),
            Op::Ell(14.0, 6.0, 6.0),
            Op::Push, Op::Tr(-2.0, -6.0, 0.0), Op::Cone(4.0, 12.0), Op::Pop,
            Op::Push, Op::Tr(-16.0, 0.0, 0.0), Op::Box3(4.0, 18.0, 2.0), Op::Pop,
            Op::Pop,
            Op::Pop,
        ]);
        ops
    }

    // Diagnostic (not a gate): how much colour variation the specular geometry
    // shows. Gouraud gives a highlight only if it lands on a vertex, so a
    // per-fragment pass should raise both the distinct-colour count and the peak.
    #[test]
    fn specular_variation_report() {
        let ops = seaquest_ops();
        let h = fresh();
        run(h, &ops);
        let px = &crate::cv(h).px;
        let mut cols = std::collections::HashSet::new();
        let mut peak = 0u16;
        for c in px.chunks_exact(4) {
            cols.insert((c[0], c[1], c[2]));
            let l = c[0] as u16 + c[1] as u16 + c[2] as u16;
            if l > peak { peak = l; }
        }
        println!("distinct colours {}  peak luma-sum {}", cols.len(), peak);
    }
    #[test]
    fn golden_seaquest_like() {
        let ops = seaquest_ops();
        let hh = scene_hash("seaquest_like", &ops);
        assert_eq!(hh, GOLD_SEA, "seaquest_like hash {}", hh);
    }

    // Frame micro-benchmark: `cargo test --release bench_frame -- --ignored --nocapture`.
    // Replays the seaquest-like scene and prints microseconds per frame; the
    // number to beat is recorded in P5_WEBGL_PLAN.md.
    #[test]
    #[ignore]
    fn bench_frame() {
        let ops = seaquest_ops();
        let h = fresh();
        for _ in 0..200 { rs_3d_frame_begin(); run(h, &ops); }
        let n = 3000;
        let t = std::time::Instant::now();
        for _ in 0..n { rs_3d_frame_begin(); run(h, &ops); }
        let us = t.elapsed().as_secs_f64() * 1e6 / n as f64;
        eprintln!("BENCH_FRAME {:.2} us/frame", us);
    }

    // Two identical frames must hash identically (state resets are complete),
    // and the per-frame path must not grow any buffer (allocation rule).
    #[test]
    fn frame_repeat_is_stable_and_alloc_free() {
        let ops = [
            Op::Bg(10.0, 30.0, 60.0),
            Op::AL(40.0, 80.0, 120.0),
            Op::DL(200.0, 240.0, 255.0, 0.5, 1.0, -0.5),
            Op::Push, Op::Tr(-100.0, 0.0, 0.0), Op::Fill(200.0, 0.0, 0.0), Op::Sph(40.0), Op::Pop,
            Op::Push, Op::Tr(100.0, 0.0, 0.0), Op::Ry(0.3), Op::Fill(0.0, 200.0, 0.0), Op::Cyl(20.0, 90.0), Op::Pop,
            Op::Push, Op::Tr(0.0, 100.0, 0.0), Op::Fill(0.0, 0.0, 200.0), Op::Cone(30.0, 60.0), Op::Pop,
        ];
        let h = fresh();
        run(h, &ops);
        let h1 = fnv(&crate::cv(h).px);
        let (cap_xv, cap_st) = {
            let t = rs().three.as_ref().unwrap();
            (t.xv.capacity(), t.stack.capacity())
        };
        for _ in 0..3 {
            rs_3d_frame_begin();
            run(h, &ops);
        }
        assert_eq!(h1, fnv(&crate::cv(h).px));
        let t = rs().three.as_ref().unwrap();
        assert_eq!((t.xv.capacity(), t.stack.capacity()), (cap_xv, cap_st), "per-frame path grew a buffer");
        if let Ok(d) = std::env::var("THREE_DUMP_DIR") {
            dump_bmp(&format!("{}/prims.bmp", d), 64, 64, &crate::cv(h).px);
        }
    }

    const GOLD_BOX: u64 = 15669850146622006379;
    const GOLD_ROT: u64 = 6833457957690475568;
    const GOLD_SEA: u64 = 13978479596181124416;
}
