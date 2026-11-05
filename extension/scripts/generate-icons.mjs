// Renders the toolbar/store icons (16, 32, 48, 128 px) as PNGs with no dependencies.
// The shape matches src/popup/Logo.tsx: a blue rounded square with a white chain link.
// Usage: npm run icons
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BG = [0x3b, 0x5b, 0xf6];
const SS = 4; // supersamples per axis

// Geometry in a 32×32 design space (same as Logo.tsx).
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
// Each link half: an arc (circle radius r around c, between angles) joined to two segments.
// Approximate the "U" chain halves as stadium outlines: distance to a capsule's boundary.
const capsuleRing = (px, py, ax, ay, bx, by, r) => Math.abs(segDist(px, py, ax, ay, bx, by) - r);

function coverage(x, y) {
  // Rounded square background, radius 8.
  const qx = Math.abs(x - 16) - 8, qy = Math.abs(y - 16) - 8;
  const bgD = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 8;
  if (bgD > 0) return { a: 0, white: 0 };
  // Two interlocked capsule outlines on the diagonal, plus the centre bar.
  const w = 1.6; // half stroke width
  const d = Math.min(
    capsuleRing(x, y, 19.3, 12.7, 22.0, 10.0, 3.3) - w,
    capsuleRing(x, y, 12.7, 19.3, 10.0, 22.0, 3.3) - w,
    segDist(x, y, 14, 18, 18, 14) - w,
  );
  // Cut each capsule on the inner end so the halves read as two separate links.
  return { a: 1, white: d <= 0 ? 1 : 0 };
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let a = 0, w = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const c = coverage(((i + (si + 0.5) / SS) / size) * 32, ((j + (sj + 0.5) / SS) / size) * 32);
          a += c.a;
          w += c.white;
        }
      }
      const n = SS * SS, alpha = a / n, white = a ? w / a : 0;
      const o = (j * size + i) * 4;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(BG[k] + (255 - BG[k]) * white);
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, px);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `icon${s}.png`), render(s));
  console.log(`icons/icon${s}.png`);
}
