import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, statusDot } from "../src/icons.js";

function chunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const out = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    out.push({ type: png.toString("ascii", off + 4, off + 8), data: png.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  return out;
}

describe("encodePng", () => {
  it("writes a valid RGBA PNG", () => {
    const rgba = Buffer.alloc(2 * 2 * 4, 0xff);
    const png = encodePng(2, 2, rgba);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(parts[0].data.readUInt32BE(0)).toBe(2);
    expect(parts[0].data.readUInt32BE(4)).toBe(2);
    // Each scanline is a filter byte plus the pixels.
    expect(inflateSync(parts[1].data)).toEqual(Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255]));
  });
});

describe("statusDot", () => {
  it("draws a filled circle of the given colour with a transparent background", () => {
    const { size, rgba } = statusDot(16, [0x22, 0xcc, 0x44]);
    expect(size).toBe(16);
    const px = (x: number, y: number) => Array.from(rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4));
    expect(px(8, 8)).toEqual([0x22, 0xcc, 0x44, 255]);
    expect(px(0, 0)[3]).toBe(0);
  });
});
