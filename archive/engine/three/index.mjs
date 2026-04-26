/**
 * fast-llm-games engine: a Raylib-style API on top of Three.js + Dawn WebGPU.
 *
 * Designed for LLM-authored RL game environments. The API mimics Raylib's
 * naming and signatures so LLMs can lean on patterns they've seen thousands
 * of times in C/Python/Go raylib examples — but the implementation runs on
 * Three.js + Dawn for headless WebGPU rendering and adds RL-specific bits
 * (deterministic update loop, mulberry32 RNG, score/state contract, action
 * injection via globalThis.currentAction).
 *
 * Architecture: thin retained-mode wrapper. Despite the immediate-mode-looking
 * API names (drawCube etc.), entities you create persist across frames. Mutate
 * their position/scale/visibility in update(); call render() once per frame.
 *
 * References:
 *   - https://www.raylib.com/cheatsheet/cheatsheet.html  (API surface)
 *   - reference/raylib/raylib.h                          (canonical signatures)
 *   - reference/raylib/rcamera.h                         (camera modes)
 */

// ============================================================================
// Color palette (ported from raylib.h — saturated, semantically usable)
// ============================================================================

export const LIGHTGRAY  = 0xc8c8c8;
export const GRAY       = 0x828282;
export const DARKGRAY   = 0x505050;
export const YELLOW     = 0xfdf900;
export const GOLD       = 0xffcb00;
export const ORANGE     = 0xffa100;
export const PINK       = 0xff6dc2;
export const RED        = 0xe62937;
export const MAROON     = 0xbe2137;
export const GREEN      = 0x00e430;
export const LIME       = 0x009e2f;
export const DARKGREEN  = 0x00752c;
export const SKYBLUE    = 0x66bfff;
export const BLUE       = 0x0079f1;
export const DARKBLUE   = 0x0052ac;
export const PURPLE     = 0xc87aff;
export const VIOLET     = 0x873cbe;
export const DARKPURPLE = 0x701f7e;
export const BEIGE      = 0xd3b083;
export const BROWN      = 0x7f6a4f;
export const DARKBROWN  = 0x4c3f2f;
export const WHITE      = 0xffffff;
export const BLACK      = 0x000000;
export const BLANK      = 0x00000000; // alpha 0
export const MAGENTA    = 0xff00ff;
export const RAYWHITE   = 0xf5f5f5;

/** Semantic color groups — use these in game logic for consistent meaning. */
export const palette = {
  // function-encoded
  goal:    GOLD,
  hostile: RED,
  passive: SKYBLUE,
  player:  WHITE,
  safe:    GREEN,
  hazard:  MAROON,
  pickup:  GOLD,
  // ground/world
  ground:  DARKGRAY,
  wall:    GRAY,
  sky:     SKYBLUE,
  // raylib classics
  RAYWHITE, LIGHTGRAY, GRAY, DARKGRAY,
  YELLOW, GOLD, ORANGE, PINK, RED, MAROON,
  GREEN, LIME, DARKGREEN,
  SKYBLUE, BLUE, DARKBLUE,
  PURPLE, VIOLET, DARKPURPLE,
  BEIGE, BROWN, DARKBROWN,
  WHITE, BLACK, MAGENTA, BLANK,
};

// ============================================================================
// Camera modes (ported from rcamera.h)
// ============================================================================

export const CAMERA_CUSTOM       = 0;
export const CAMERA_FREE         = 1;
export const CAMERA_ORBITAL      = 2;
export const CAMERA_FIRST_PERSON = 3;
export const CAMERA_THIRD_PERSON = 4;
export const CAMERA_FIXED_TOPDOWN = 5;  // our addition: static iso for grid games
export const CAMERA_FOLLOW_2D    = 6;   // our addition: 2D-style follow for runners

/**
 * Create a Camera3D — returns a REAL `THREE.PerspectiveCamera` instance.
 *
 * Engine extras (mode, target, fovy) live on `camera.userData` so the rest
 * of Three.js's API works as expected:
 *   - camera.position.set(x, y, z)   ✓ (real Vector3)
 *   - camera.position.y = 5          ✓
 *   - camera.lookAt(x, y, z)         ✓ (real Three.js method)
 *   - camera.rotation, camera.up,
 *     camera.getWorldPosition(...)    ✓ (real Three.js methods)
 *
 * The engine's `updateCamera(camera, target, dt)` reads
 * `camera.userData.mode` to decide preset behavior.
 *
 * Why a factory and not a class wrapper: any subclass-style wrapper would
 * inevitably miss methods the LLM tries to call. By returning the real
 * THREE.PerspectiveCamera, we avoid an entire class of "this method
 * doesn't exist" surprises.
 */
export function createCamera({ THREE, position = [0, 8, 8], target = [0, 0, 0], up = [0, 1, 0],
                               fovy = 60, aspect = 1, near = 0.1, far = 100, mode = CAMERA_CUSTOM } = {}) {
  if (!THREE) throw new Error('createCamera requires THREE');
  const cam = new THREE.PerspectiveCamera(fovy, aspect, near, far);
  cam.position.set(position[0], position[1], position[2]);
  cam.up.set(up[0], up[1], up[2]);
  cam.lookAt(target[0], target[1], target[2]);

  // LLM-forgiveness: expose `camera.target` as a Vector3 with auto-sync.
  // The Three.js convention is `camera.lookAt(...)`, but LLMs frequently
  // reach for `camera.target.set(...)` (the OrbitControls convention).
  // Make both work — patch .set() and .copy() to trigger lookAt automatically.
  const targetVec = new THREE.Vector3(target[0], target[1], target[2]);
  const _origSet = targetVec.set.bind(targetVec);
  const _origCopy = targetVec.copy.bind(targetVec);
  targetVec.set = function (x, y, z) {
    _origSet(x, y, z);
    cam.lookAt(targetVec);
    return targetVec;
  };
  targetVec.copy = function (v) {
    _origCopy(v);
    cam.lookAt(targetVec);
    return targetVec;
  };
  cam.target = targetVec;

  // Engine extras (engine's preset camera modes read these)
  cam.userData.mode = mode;
  cam.userData.target = targetVec;  // shared instance with cam.target
  cam.userData.fovy = fovy;
  return cam;
}

/** Backwards-compat alias. Camera3D(...) now returns a real PerspectiveCamera. */
export const Camera3D = (opts) => createCamera(opts);

/**
 * updateCamera(camera, target, dt, opts) — port of raylib's preset camera modes.
 *
 * Camera is a real THREE.PerspectiveCamera; we mutate its position + lookAt
 * each frame based on the mode (in camera.userData.mode) and the target entity.
 * For CAMERA_FREE / CAMERA_CUSTOM, this is a no-op — the game manages the
 * camera itself.
 */
export function updateCamera(camera, target, dt, opts = {}) {
  const {
    distance = 8,
    height = 4,
    smoothing = 8,
    mode = camera.userData?.mode ?? CAMERA_CUSTOM,
  } = opts;

  const tx = target.position?.x ?? target.x ?? 0;
  const ty = target.position?.y ?? target.y ?? 0;
  const tz = target.position?.z ?? target.z ?? 0;

  if (mode === CAMERA_THIRD_PERSON || mode === CAMERA_FOLLOW_2D) {
    const k = Math.min(1, smoothing * dt);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += ((ty + height) - camera.position.y) * k;
    camera.position.z += ((tz + distance) - camera.position.z) * k;
    camera.lookAt(tx, ty + 0.5, tz);
  } else if (mode === CAMERA_FIRST_PERSON) {
    const yaw = target.yaw ?? 0;
    camera.position.set(tx, ty + 1.5, tz);
    camera.lookAt(tx - Math.sin(yaw), ty + 1.5, tz - Math.cos(yaw));
  } else if (mode === CAMERA_ORBITAL) {
    const angle = opts.angle ?? 0;
    camera.position.x = tx + Math.cos(angle) * distance;
    camera.position.z = tz + Math.sin(angle) * distance;
    camera.position.y = ty + height;
    camera.lookAt(tx, ty, tz);
  } else if (mode === CAMERA_FIXED_TOPDOWN) {
    camera.lookAt(tx, ty, tz);  // re-aim at target each frame, but don't move
  }
  // CAMERA_FREE / CAMERA_CUSTOM: leave camera alone.
}

// ============================================================================
// World — holds scene, materials/geometry pools, deterministic state
// ============================================================================

/**
 * Initialize a world. Call this once in setup().
 * Returns a world handle with scene, renderer, camera helpers, and pooled
 * resources. All draw* / add* / spawn* functions operate on this world.
 */
export function initWorld({ THREE, renderer, width, height } = {}) {
  if (!THREE) throw new Error('initWorld requires THREE');
  if (!renderer) throw new Error('initWorld requires renderer');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKYBLUE);

  const world = {
    THREE,
    renderer,
    scene,
    width,
    height,
    aspect: width / height,
    _materialPool: new Map(),  // color (number) → MeshLambertMaterial
    _geometryPool: new Map(),  // key (string) → Geometry
    _activeCamera: null,
    _frame: 0,
    _transientMeshes: [],      // particles etc., garbage-collected by life
  };

  // Default 3-point lighting. Games can override via setupLighting().
  setupLighting(world, '3point');

  return world;
}

/**
 * Set the scene background color. Equivalent to raylib's ClearBackground
 * (which clears the framebuffer; here we set the persistent scene bg).
 */
export function setBackground(world, color) {
  world.scene.background = new world.THREE.Color(color);
}

/**
 * Lighting presets. 3-point is the default — looks good for most games.
 *   '3point'   — ambient + key directional + softer fill directional
 *   'ambient'  — ambient only (flat shading)
 *   'dramatic' — strong directional + low ambient (shadows / contrast)
 */
export function setupLighting(world, preset = '3point') {
  // Remove existing lights
  const toRemove = [];
  world.scene.traverse(o => { if (o.isLight) toRemove.push(o); });
  for (const o of toRemove) world.scene.remove(o);

  const { THREE, scene } = world;
  if (preset === '3point') {
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(5, 10, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-5, 4, -3);
    scene.add(fill);
  } else if (preset === 'ambient') {
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  } else if (preset === 'dramatic') {
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(8, 12, 4);
    scene.add(key);
  }
}

// ============================================================================
// Material + Geometry pooling (avoids the Three.js NodeMaterial pipeline
// blow-up we hit when many distinct materials are created over time)
// ============================================================================

function _getMaterial(world, color, kind = 'lambert') {
  const key = `${kind}:${color}`;
  let mat = world._materialPool.get(key);
  if (!mat) {
    const { THREE } = world;
    if (kind === 'basic') mat = new THREE.MeshBasicMaterial({ color });
    else if (kind === 'normal') mat = new THREE.MeshNormalMaterial();
    else if (kind === 'phong') mat = new THREE.MeshPhongMaterial({ color });
    else mat = new THREE.MeshLambertMaterial({ color });
    world._materialPool.set(key, mat);
  }
  return mat;
}

function _getGeometry(world, key, factory) {
  let geo = world._geometryPool.get(key);
  if (!geo) {
    geo = factory(world.THREE);
    world._geometryPool.set(key, geo);
  }
  return geo;
}

// ============================================================================
// Drawing primitives — Raylib API style
//
// These ADD a persistent mesh to the scene and return a Mesh handle.
// Despite the "draw" naming (matching raylib's verbs), the mesh stays
// across frames — mutate its .position/.scale/.visible in update().
// To remove, call removeMesh(world, mesh).
// ============================================================================

function _toVec3(THREE, v) {
  if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
  if (v.isVector3) return v;
  if (typeof v === 'object' && 'x' in v) return new THREE.Vector3(v.x, v.y ?? 0, v.z ?? 0);
  return new THREE.Vector3(0, 0, 0);
}

/** drawCube(world, position, width, height, length, color) — like raylib's DrawCube. */
export function drawCube(world, position, width, height, length, color) {
  const { THREE } = world;
  const geo = _getGeometry(world, `box:${width}x${height}x${length}`,
    (T) => new T.BoxGeometry(width, height, length));
  const mat = _getMaterial(world, color);
  const mesh = new THREE.Mesh(geo, mat);
  const p = _toVec3(THREE, position);
  mesh.position.copy(p);
  world.scene.add(mesh);
  return mesh;
}

/** drawCubeV(world, position, sizeVec3, color) — vector-size variant. */
export function drawCubeV(world, position, size, color) {
  const s = Array.isArray(size) ? size : [size.x, size.y, size.z];
  return drawCube(world, position, s[0], s[1], s[2], color);
}

/** drawSphere(world, centerPos, radius, color) */
export function drawSphere(world, centerPos, radius, color, opts = {}) {
  const { THREE } = world;
  const segs = opts.segments ?? 16;
  const geo = _getGeometry(world, `sphere:${radius}:${segs}`,
    (T) => new T.SphereGeometry(radius, segs, segs));
  const mat = _getMaterial(world, color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(_toVec3(THREE, centerPos));
  world.scene.add(mesh);
  return mesh;
}

/** drawCylinder(world, position, radiusTop, radiusBottom, height, sides, color) */
export function drawCylinder(world, position, radiusTop, radiusBottom, height, sides, color) {
  const { THREE } = world;
  const geo = _getGeometry(world, `cyl:${radiusTop}:${radiusBottom}:${height}:${sides}`,
    (T) => new T.CylinderGeometry(radiusTop, radiusBottom, height, sides));
  const mat = _getMaterial(world, color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(_toVec3(THREE, position));
  world.scene.add(mesh);
  return mesh;
}

/** drawCone(world, position, radius, height, sides, color) */
export function drawCone(world, position, radius, height, sides, color) {
  const { THREE } = world;
  const geo = _getGeometry(world, `cone:${radius}:${height}:${sides}`,
    (T) => new T.ConeGeometry(radius, height, sides));
  const mat = _getMaterial(world, color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(_toVec3(THREE, position));
  world.scene.add(mesh);
  return mesh;
}

/** drawOctahedron(world, position, radius, color) — great for goals/pickups. */
export function drawOctahedron(world, position, radius, color) {
  const { THREE } = world;
  const geo = _getGeometry(world, `oct:${radius}`,
    (T) => new T.OctahedronGeometry(radius));
  const mat = _getMaterial(world, color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(_toVec3(THREE, position));
  world.scene.add(mesh);
  return mesh;
}

/** drawPlane(world, centerPos, sizeVec2, color) — XZ plane (raylib convention). */
export function drawPlane(world, centerPos, size, color) {
  const { THREE } = world;
  const sx = Array.isArray(size) ? size[0] : (size.x ?? size);
  const sy = Array.isArray(size) ? size[1] : (size.y ?? size);
  const geo = _getGeometry(world, `plane:${sx}x${sy}`,
    (T) => new T.PlaneGeometry(sx, sy));
  const mat = _getMaterial(world, color);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(_toVec3(THREE, centerPos));
  world.scene.add(mesh);
  return mesh;
}

/** drawGrid(world, slices, spacing) — XZ grid centered at origin. */
export function drawGrid(world, slices = 20, spacing = 1, color = LIGHTGRAY) {
  const { THREE } = world;
  const points = [];
  const half = (slices * spacing) / 2;
  for (let i = 0; i <= slices; i++) {
    const t = -half + i * spacing;
    points.push(new THREE.Vector3(-half, 0, t), new THREE.Vector3(half, 0, t));
    points.push(new THREE.Vector3(t, 0, -half), new THREE.Vector3(t, 0, half));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color });
  const grid = new THREE.LineSegments(geo, mat);
  world.scene.add(grid);
  return grid;
}

/** drawLine3D(world, startPos, endPos, color) */
export function drawLine3D(world, startPos, endPos, color) {
  const { THREE } = world;
  const a = _toVec3(THREE, startPos);
  const b = _toVec3(THREE, endPos);
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(geo, mat);
  world.scene.add(line);
  return line;
}

/** Remove a mesh (or any Object3D) from the world's scene. */
export function removeMesh(world, mesh) {
  world.scene.remove(mesh);
}

/** Remove ALL meshes from the world. Useful for resetGame(). */
export function clearWorld(world) {
  // Keep lights, remove everything else.
  const toRemove = [];
  for (const o of world.scene.children) {
    if (!o.isLight) toRemove.push(o);
  }
  for (const o of toRemove) world.scene.remove(o);
  world._transientMeshes.length = 0;
}

// ============================================================================
// BeginMode3D / EndMode3D + render
// ============================================================================

/** Set the active camera for rendering. */
export function beginMode3D(world, camera) {
  world._activeCamera = camera;
}

/** End 3D mode (currently a no-op; kept for API parity with raylib). */
export function endMode3D(world) {
  // Could be used later for command-buffer batching.
}

/** Render the scene with the active camera. */
export function render(world, camera) {
  const cam = camera ?? world._activeCamera;
  if (!cam) throw new Error('render: no active camera (call beginMode3D(world, camera) first)');
  world.renderer.render(world.scene, cam);
}

// ============================================================================
// Collision helpers (port of raylib's CheckCollision* / GetRayCollision*)
// ============================================================================

export function checkCollisionSpheres(center1, radius1, center2, radius2) {
  const dx = (center1.x ?? center1[0]) - (center2.x ?? center2[0]);
  const dy = (center1.y ?? center1[1]) - (center2.y ?? center2[1]);
  const dz = (center1.z ?? center1[2]) - (center2.z ?? center2[2]);
  const r = radius1 + radius2;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

export function checkCollisionBoxes(box1, box2) {
  // box: { min: {x,y,z}, max: {x,y,z} } or { x,y,z, width,height,depth }
  const a = _normalizeBox(box1);
  const b = _normalizeBox(box2);
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}

export function checkCollisionBoxSphere(box, center, radius) {
  const b = _normalizeBox(box);
  const cx = center.x ?? center[0];
  const cy = center.y ?? center[1];
  const cz = center.z ?? center[2];
  const closestX = Math.max(b.min.x, Math.min(cx, b.max.x));
  const closestY = Math.max(b.min.y, Math.min(cy, b.max.y));
  const closestZ = Math.max(b.min.z, Math.min(cz, b.max.z));
  const dx = cx - closestX, dy = cy - closestY, dz = cz - closestZ;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function _normalizeBox(b) {
  if (b.min && b.max) return b;
  const w = b.width ?? b.w ?? 1;
  const h = b.height ?? b.h ?? 1;
  const d = b.depth ?? b.d ?? 1;
  const cx = b.x ?? 0, cy = b.y ?? 0, cz = b.z ?? 0;
  return {
    min: { x: cx - w/2, y: cy - h/2, z: cz - d/2 },
    max: { x: cx + w/2, y: cy + h/2, z: cz + d/2 },
  };
}

// ============================================================================
// Math helpers (raymath subset)
// ============================================================================

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothLerp(current, target, dt, k = 8) {
  return lerp(current, target, Math.min(1, k * dt));
}
export const Vector3 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s }),
  distance: (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  },
  distanceSq: (a, b) => {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx*dx + dy*dy + dz*dz;
  },
  length: (v) => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z),
  normalize: (v) => {
    const l = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z) || 1;
    return { x: v.x/l, y: v.y/l, z: v.z/l };
  },
  zero: () => ({ x: 0, y: 0, z: 0 }),
  one: () => ({ x: 1, y: 1, z: 1 }),
};

// ============================================================================
// RL contract helpers
// ============================================================================

/** Mulberry32 — seeded RNG. Call resetGame() then `Math.random = mulberry32(seed)`. */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Read the current discrete action injected by the runtime. Integer 0..14. */
export function getCurrentAction() {
  return globalThis.currentAction ?? 0;
}

// ============================================================================
// Polish helpers (the things every good v2 game adds itself)
// ============================================================================

/**
 * Spawn a primitive-particle burst at `pos`. Auto-cleaned after `life` seconds.
 * Call updateTransients(world, dt) each frame to advance + cull.
 */
export function spawnParticleBurst(world, pos, color, opts = {}) {
  const { THREE } = world;
  const count = opts.count ?? 8;
  const speed = opts.speed ?? 4;
  const life = opts.life ?? 0.5;
  const size = opts.size ?? 0.1;
  const geo = _getGeometry(world, `box:${size}x${size}x${size}`,
    (T) => new T.BoxGeometry(size, size, size));
  const mat = _getMaterial(world, color, 'basic');
  const p = _toVec3(THREE, pos);
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const sp = speed * (0.5 + Math.random() * 0.5);
    m.userData = {
      vx: Math.sin(phi) * Math.cos(theta) * sp,
      vy: Math.cos(phi) * sp + 1,
      vz: Math.sin(phi) * Math.sin(theta) * sp,
      life,
    };
    world.scene.add(m);
    world._transientMeshes.push(m);
  }
}

/** Advance + cull transient particles. Call once per frame in update(). */
export function updateTransients(world, dt) {
  const remaining = [];
  for (const m of world._transientMeshes) {
    m.userData.life -= dt;
    if (m.userData.life <= 0) {
      world.scene.remove(m);
      continue;
    }
    m.userData.vy -= 9.8 * dt;
    m.position.x += m.userData.vx * dt;
    m.position.y += m.userData.vy * dt;
    m.position.z += m.userData.vz * dt;
    m.scale.setScalar(Math.max(0.05, m.userData.life * 2));
    remaining.push(m);
  }
  world._transientMeshes = remaining;
}

/**
 * Briefly tint a mesh to `flashColor` for `durationMs`, then restore.
 * Useful for hit feedback. Stores original material on the mesh.
 */
export function hitFlash(world, mesh, flashColor, durationMs = 150) {
  if (!mesh.userData.origMaterial) mesh.userData.origMaterial = mesh.material;
  mesh.material = _getMaterial(world, flashColor, 'basic');
  setTimeout(() => {
    if (mesh.userData.origMaterial) {
      mesh.material = mesh.userData.origMaterial;
      mesh.userData.origMaterial = null;
    }
  }, durationMs);
}
// NOTE: hitFlash uses setTimeout — NOT deterministic in headless RL. Use only
// in the browser tester. For deterministic flash, decrement a counter in update().
//
// Deterministic alternative:
export function flashFor(mesh, flashColor, frames = 6) {
  if (!mesh.userData._flashFrames) mesh.userData._flashFrames = 0;
  mesh.userData._flashFrames = frames;
  mesh.userData._flashColor = flashColor;
}
export function tickFlashes(world, meshes) {
  for (const m of meshes) {
    if (!m.userData._flashFrames || m.userData._flashFrames <= 0) continue;
    if (!m.userData.origMaterial) m.userData.origMaterial = m.material;
    m.userData._flashFrames -= 1;
    if (m.userData._flashFrames <= 0) {
      m.material = m.userData.origMaterial;
      m.userData.origMaterial = null;
    } else {
      m.material = _getMaterial(world, m.userData._flashColor, 'basic');
    }
  }
}

// ============================================================================
// Convenience: a single-call setup that mimics raylib's main() pattern
// ============================================================================

/**
 * Standard game template — call this in your setup() to get a world + camera
 * with sensible defaults. Returns { world, camera }.
 */
export function setupGame({ THREE, renderer, width, height, cameraMode = CAMERA_THIRD_PERSON, cameraOpts = {} } = {}) {
  const world = initWorld({ THREE, renderer, width, height });
  const camera = createCamera({
    THREE,
    aspect: width / height,
    fovy: cameraOpts.fovy ?? 60,
    position: cameraOpts.position ?? [0, 8, 8],
    target: cameraOpts.target ?? [0, 0, 0],
    mode: cameraMode,
  });
  beginMode3D(world, camera);
  return { world, camera };
}

// Shorter alias for grouped imports.
export default {
  // colors
  palette,
  LIGHTGRAY, GRAY, DARKGRAY, YELLOW, GOLD, ORANGE, PINK, RED, MAROON,
  GREEN, LIME, DARKGREEN, SKYBLUE, BLUE, DARKBLUE, PURPLE, VIOLET, DARKPURPLE,
  BEIGE, BROWN, DARKBROWN, WHITE, BLACK, BLANK, MAGENTA, RAYWHITE,
  // camera modes
  CAMERA_CUSTOM, CAMERA_FREE, CAMERA_ORBITAL, CAMERA_FIRST_PERSON,
  CAMERA_THIRD_PERSON, CAMERA_FIXED_TOPDOWN, CAMERA_FOLLOW_2D,
  // camera
  Camera3D, createCamera,
  // world
  initWorld, setBackground, setupLighting, clearWorld,
  // drawing
  drawCube, drawCubeV, drawSphere, drawCylinder, drawCone, drawOctahedron,
  drawPlane, drawGrid, drawLine3D, removeMesh,
  // camera
  updateCamera, beginMode3D, endMode3D, render,
  // collision
  checkCollisionSpheres, checkCollisionBoxes, checkCollisionBoxSphere,
  // math
  clamp, lerp, smoothLerp, Vector3,
  // RL
  mulberry32, getCurrentAction,
  // polish
  spawnParticleBurst, updateTransients, hitFlash, flashFor, tickFlashes,
  // convenience
  setupGame,
};
