import { describe, expect, it } from "vitest";
import { entryChanged } from "../src/state/updates.js";

const page = (name: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/${name}"></script></head></html>`;

describe("entryChanged", () => {
  it("is false while the host still serves the bundle this page loaded", () => {
    expect(entryChanged(page("index-DIjoxTLw.js"), "/assets/index-DIjoxTLw.js")).toBe(false);
  });

  it("is true once the host serves a differently hashed bundle", () => {
    expect(entryChanged(page("index-B8CIU_QM.js"), "/assets/index-DIjoxTLw.js")).toBe(true);
  });

  it("is false for a page that is not the app shell at all", () => {
    expect(entryChanged("<html>Not Found</html>", "/assets/index-DIjoxTLw.js")).toBe(false);
  });
});
