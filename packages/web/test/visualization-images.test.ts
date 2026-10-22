import { describe, expect, it, vi } from "vitest";
import { visualizationImageLoader, visualizationImagePath } from "../src/ui/visualization-images.js";

const page = "/Users/test/gallery/index.html";

describe("sandbox image requests", () => {
  it("resolves relative and script-generated absolute image URLs", () => {
    expect(visualizationImagePath("partner/step.png", page)).toBe("/Users/test/gallery/partner/step.png");
    expect(visualizationImagePath("https://pocket.invalid/Users/test/gallery/partner/step.png", page)).toBe("/Users/test/gallery/partner/step.png");
  });

  it.each([
    "../secret.png", "/Users/test/gallery-other/private.png", "/Users/test/gallery/../private.png",
    "https://pocket.invalid/Users/test/gallery/%2e%2e%2fprivate.png", "file:///Users/test/gallery/a.png",
    "https://example.com/Users/test/gallery/a.png", "https://user@pocket.invalid/Users/test/gallery/a.png",
    "data:image/png;base64,AAAA", "private.json", "a%00.png", "a%5c.png", null, {},
  ])("rejects requests outside the page directory and non-image resources: %j", (url) => {
    expect(visualizationImagePath(url, page)).toBeNull();
  });

  it("deduplicates reads and limits concurrency", async () => {
    const releases: Array<(data: string) => void> = [];
    const read = vi.fn(() => new Promise<string>((resolve) => releases.push(resolve)));
    const load = visualizationImageLoader(page, read);
    const first = load("1.png");
    expect(load("1.png")).toBe(first);
    const pending = [first, ...Array.from({ length: 5 }, (_, n) => load(`${n + 2}.png`))];
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(4);
    for (let n = 0; n < pending.length; n++) {
      while (!releases[n]) await Promise.resolve();
      releases[n]("data:image/png;base64,AAAA");
    }
    await Promise.all(pending);
    expect(read).toHaveBeenCalledTimes(6);
  });

  it("starts the next read when any slot frees, even if the first read is slow", async () => {
    const releases: Array<(data: string) => void> = [];
    const read = vi.fn(() => new Promise<string>((resolve) => releases.push(resolve)));
    const load = visualizationImageLoader(page, read);
    const pending = Array.from({ length: 5 }, (_, n) => load(`${n}.png`));
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(4);
    releases[1]("second");
    await pending[1];
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(5);
    releases[0]("first");
    releases[2]("third");
    releases[3]("fourth");
    releases[4]("fifth");
    await Promise.all(pending);
  });

  it("caps the number of files read by a preview", async () => {
    const read = vi.fn(async () => "data:image/png;base64,AAAA");
    const load = visualizationImageLoader(page, read);
    const result = await Promise.all(Array.from({ length: 130 }, (_, n) => load(`${n}.png`)));
    expect(read).toHaveBeenCalledTimes(128);
    expect(result.slice(128)).toEqual([null, null]);
  });
});
