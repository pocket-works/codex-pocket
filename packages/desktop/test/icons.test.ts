import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng, trayGlyph } from "../src/icons.js";

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

describe("trayGlyph", () => {
  const px = (bmp: { size: number; rgba: Buffer }, x: number, y: number) => Array.from(bmp.rgba.subarray((y * bmp.size + x) * 4, (y * bmp.size + x) * 4 + 4));

  it("draws the phone in its pocket with the status dot on the screen", () => {
    const bmp = trayGlyph({ size: 32, glyph: [0, 0, 0], dot: [0x22, 0xcc, 0x44] });
    expect(px(bmp, 16, 24)).toEqual([0, 0, 0, 255]); // pocket
    expect(px(bmp, 15, 13)).toEqual([0, 0, 0, 255]); // phone
    expect(px(bmp, 16, 17)[3]).toBeLessThan(64); // inside the flap cut
    expect(px(bmp, 0, 0)[3]).toBe(0);
    expect(px(bmp, 16, 8)).toEqual([0x22, 0xcc, 0x44, 255]); // dot centre
  });

  it("dims the glyph but not the dot when asked", () => {
    const bmp = trayGlyph({ size: 32, glyph: [255, 255, 255], glyphAlpha: 0.4, dot: [9, 9, 9] });
    expect(px(bmp, 16, 24)[3]).toBe(102);
    expect(px(bmp, 16, 8)).toEqual([9, 9, 9, 255]);
  });
});
