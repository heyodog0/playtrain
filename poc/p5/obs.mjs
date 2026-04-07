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
