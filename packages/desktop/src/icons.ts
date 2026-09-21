import { deflateSync } from "node:zlib";

// The tray icon is rasterised at runtime, so there are no image assets to
// keep in sync with the state list or the menu bar theme.

export type Rgb = [number, number, number];

export interface Bitmap {
  size: number;
  rgba: Buffer;
}

export interface TrayGlyphOptions {
  /** Pixel size; the glyph is designed on a 16pt grid and scaled. */
  size: number;
  /** Colour of the phone outline: black on a light menu bar, white on a dark one. */
  glyph: Rgb;
  glyphAlpha?: number;
  /** Colour of the status dot in the bottom-right corner. */
  dot: Rgb;
}

// Signed distance to a rounded rectangle; negative inside.
function roundedRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

const coverage = (d: number) => Math.max(0, Math.min(1, 0.5 - d));

/** A phone outline with a status dot over its bottom-right corner. */
export function trayGlyph(o: TrayGlyphOptions): Bitmap {
  const { size } = o;
  const k = size / 16;
  const glyphAlpha = o.glyphAlpha ?? 1;
  const rgba = Buffer.alloc(size * size * 4);
  // Geometry on the 16pt grid.
  const stroke = 1.5 * k;
  const body = { cx: 7.5 * k, cy: 8 * k, hw: 4 * k, hh: 6.5 * k, r: 2 * k };
  const dot = { cx: 12.5 * k, cy: 12.5 * k, r: 3 * k, gap: 1 * k };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const dDot = Math.hypot(px - dot.cx, py - dot.cy) - dot.r;
      const dBody = Math.abs(roundedRect(px, py, body.cx, body.cy, body.hw, body.hh, body.r)) - stroke / 2;
      // The dot punches a clear ring through the outline so it stays legible.
      const outline = coverage(dBody) * (1 - coverage(dDot - dot.gap)) * glyphAlpha;
      const dotCov = coverage(dDot);
      const i = (y * size + x) * 4;
      const a = dotCov + outline * (1 - dotCov);
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round((o.dot[c] * dotCov + o.glyph[c] * outline * (1 - dotCov)) / a);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return { size, rgba };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal PNG writer: 8-bit RGBA, no filtering. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
