/**
 * Batched in-process renderer for N envs sharing ONE WebGPU device.
 *
 * The single-env path pays the ~0.21ms GPU map-stall once per env. Here each
 * env's scene is drawn into its own tile of a sqrt(N)xsqrt(N) atlas, then the
 * whole atlas is read back in ONE copyTextureToBuffer + mapAsync — the fixed
 * fence overhead is amortized across all N envs, and per-env GPU work pipelines.
 *
 * Generic: the game module must export
 *     createInstance({ THREE, renderer, width, height }) ->
 *         { update(dt, action), resetGame(seed), getGameState(), getScene(), getCamera() }
 * Sized via PLAYTRAIN_THREE_OBS_SIZE = grid*tile (the atlas side).
 */

import { pathToFileURL } from 'url';
import { fakeContext, getRenderDevice, WIDTH, HEIGHT, createFakeCanvas } from './shims.mjs';

const FIXED_DT = 1 / 60;
const TERMINAL = new Set(['WIN', 'EXIT', 'GAMEOVER']);
const ORIGINAL_MATH_RANDOM = Math.random;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export class VecGameEnv {
  constructor({ gamePath, actionSize = 7, numEnvs, tile, maxSteps = 3600 }) {
    this.gamePath = gamePath;
    this.actionSize = actionSize;
    this.n = numEnvs;
    this.tile = tile;
    this.grid = Math.ceil(Math.sqrt(numEnvs));
    this.maxSteps = maxSteps;
    if (this.grid * tile !== WIDTH || WIDTH !== HEIGHT) {
      throw new Error(`atlas ${this.grid * tile} != shim ${WIDTH}x${HEIGHT}; set PLAYTRAIN_THREE_OBS_SIZE=${this.grid * tile}`);
    }
    this.steps = new Int32Array(numEnvs);
    this.lastScore = new Float64Array(numEnvs);
    this.seeds = new Uint32Array(numEnvs);
    this._loaded = false;
  }

  async _ensure() {
    if (this._loaded) return;
    this.THREE = await import('three/webgpu');
    globalThis.THREE = this.THREE;
    globalThis.mulberry32 = mulberry32;
    this.renderer = new this.THREE.WebGPURenderer({ canvas: createFakeCanvas() });
    this.renderer.setSize(WIDTH, HEIGHT);
    this.renderer.autoClear = true;
    await this.renderer.init();
    globalThis.renderer = this.renderer;

    const mod = await import(pathToFileURL(this.gamePath).href);
    if (typeof mod.createInstance !== 'function') {
      throw new Error(`game ${this.gamePath} must export createInstance() for the vec renderer`);
    }
    this.inst = [];
    for (let i = 0; i < this.n; i++) {
      this.inst.push(mod.createInstance({ THREE: this.THREE, renderer: this.renderer, width: this.tile, height: this.tile }));
    }

    this.renderer.setScissorTest(true);
    this._renderTiles();                       // first render to force context.configure()
    this.device = getRenderDevice();
    await this.device.queue.onSubmittedWorkDone();
    this.bytesPerRow = Math.ceil((WIDTH * 4) / 256) * 256;
    this.readBuffer = this.device.createBuffer({
      size: this.bytesPerRow * HEIGHT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.obsAll = new Uint8Array(this.n * this.tile * this.tile * 3);
    this._loaded = true;
  }

  _tileViewport(i) {
    const col = i % this.grid;
    const row = Math.floor(i / this.grid);
    return { x: col * this.tile, y: (this.grid - 1 - row) * this.tile }; // three viewport: bottom-left origin
  }

  _renderTiles() {
    for (let i = 0; i < this.n; i++) {
      const v = this._tileViewport(i);
      this.renderer.setViewport(v.x, v.y, this.tile, this.tile);
      this.renderer.setScissor(v.x, v.y, this.tile, this.tile);
      this.renderer.render(this.inst[i].getScene(), this.inst[i].getCamera());
    }
  }

  _resetOne(i, seed) {
    this.seeds[i] = seed >>> 0;
    Math.random = mulberry32(this.seeds[i]);
    this.inst[i].resetGame(this.seeds[i]);
    this.steps[i] = 0;
    this.lastScore[i] = this.inst[i].getGameState().score;
  }

  async reset(seeds) {
    await this._ensure();
    for (let i = 0; i < this.n; i++) this._resetOne(i, seeds[i]);
    return this._readback();
  }

  async step(actionsFlat, numSteps = 1) {
    await this._ensure();
    const rewards = new Float32Array(this.n);
    const term = new Uint8Array(this.n);
    const trunc = new Uint8Array(this.n);
    const k = numSteps > 0 ? numSteps : 1;
    const A = this.actionSize;
    for (let i = 0; i < this.n; i++) {
      const act = actionsFlat.subarray(i * A, i * A + A);
      let reward = 0, done = false, tr = false;
      for (let s = 0; s < k; s++) {
        this.inst[i].update(FIXED_DT, act);
        const st = this.inst[i].getGameState();
        reward += st.score - this.lastScore[i];
        this.lastScore[i] = st.score;
        this.steps[i] += 1;
        if (TERMINAL.has(st.gameState)) { done = true; break; }
        if (this.steps[i] >= this.maxSteps) { tr = true; break; }
      }
      rewards[i] = reward; term[i] = done ? 1 : 0; trunc[i] = tr ? 1 : 0;
    }
    const obs = await this._readback();
    for (let i = 0; i < this.n; i++) {
      if (term[i] || trunc[i]) this._resetOne(i, (this.seeds[i] * 1664525 + 1013904223) >>> 0);
    }
    return { obs, rewards, term, trunc };
  }

  async _readback() {
    this._renderTiles();
    const tex = fakeContext.getCurrentTexture();
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: this.readBuffer, bytesPerRow: this.bytesPerRow }, [WIDTH, HEIGHT]);
    this.device.queue.submit([enc.finish()]);
    await this.readBuffer.mapAsync(GPUMapMode.READ);
    const bgra = new Uint8Array(this.readBuffer.getMappedRange());

    const T = this.tile, bpr = this.bytesPerRow, out = this.obsAll;
    for (let i = 0; i < this.n; i++) {
      const v = this._tileViewport(i);
      const px0 = v.x;
      const py0 = HEIGHT - v.y - T;     // buffer row 0 = top; viewport y is bottom-left
      let o = i * T * T * 3;
      for (let ty = 0; ty < T; ty++) {
        let s = (py0 + ty) * bpr + px0 * 4;
        for (let tx = 0; tx < T; tx++) {
          out[o] = bgra[s + 2]; out[o + 1] = bgra[s + 1]; out[o + 2] = bgra[s];
          o += 3; s += 4;
        }
      }
    }
    this.readBuffer.unmap();
    return out;
  }

  close() {
    Math.random = ORIGINAL_MATH_RANDOM;
    if (this.readBuffer) { this.readBuffer.destroy(); this.readBuffer = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
  }
}
