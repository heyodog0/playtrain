export function preprocessObservationFromRGBA(rgba, width, height, obsWidth = 84, obsHeight = 84) {
  const out = new Uint8Array(obsWidth * obsHeight);

  for (let oy = 0; oy < obsHeight; oy++) {
    const srcY = Math.min(height - 1, Math.floor(((oy + 0.5) * height) / obsHeight));
    for (let ox = 0; ox < obsWidth; ox++) {
      const srcX = Math.min(width - 1, Math.floor(((ox + 0.5) * width) / obsWidth));
      const idx = (srcY * width + srcX) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      out[oy * obsWidth + ox] = Math.round((0.299 * r) + (0.587 * g) + (0.114 * b));
    }
  }

  return out;
}

// Fast path: input is already obs-sized BGRA from Cairo (toBuffer('raw') on LE).
// Just swap channels and drop alpha. Assumes opaque pixels (premul == straight).
export function bgraBufferToRGB(buf, obsWidth, obsHeight) {
  const out = new Uint8Array(obsWidth * obsHeight * 3);
  const n = obsWidth * obsHeight;
  for (let i = 0, s = 0, d = 0; i < n; i++, s += 4, d += 3) {
    out[d]     = buf[s + 2]; // R
    out[d + 1] = buf[s + 1]; // G
    out[d + 2] = buf[s];     // B
  }
  return out;
}

export function preprocessObservationRGB(rgba, width, height, obsWidth = 64, obsHeight = 64) {
  const out = new Uint8Array(obsWidth * obsHeight * 3);

  for (let oy = 0; oy < obsHeight; oy++) {
    const srcY = Math.min(height - 1, Math.floor(((oy + 0.5) * height) / obsHeight));
    for (let ox = 0; ox < obsWidth; ox++) {
      const srcX = Math.min(width - 1, Math.floor(((ox + 0.5) * width) / obsWidth));
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (oy * obsWidth + ox) * 3;
      out[dstIdx] = rgba[srcIdx];         // R
      out[dstIdx + 1] = rgba[srcIdx + 1]; // G
      out[dstIdx + 2] = rgba[srcIdx + 2]; // B
    }
  }

  return out;
}
