// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { localImagePath } from "../src/ui/file-citation.js";
import { renderMarkdown } from "../src/ui/markdown.js";

const happyWindow = window as unknown as Window & { happyDOM: { setURL(url: string): void } };

describe("Markdown local images", () => {
  beforeEach(() => happyWindow.happyDOM.setURL("https://pocket.example/"));

  it("marks absolute Mac image paths for app-server loading", () => {
    expect(window.location.href).toBe("https://pocket.example/");
    expect(localImagePath("/Users/test/output/chart%20one.png", window.location.href)).toBe("/Users/test/output/chart one.png");
    const html = renderMarkdown("![chart](/Users/test/output/chart%20one.png)");
    expect(html).toContain('data-local-image-path="/Users/test/output/chart one.png"');
    expect(html).not.toContain('src="/Users/test/output/chart');
  });

  it("keeps website images as browser URLs", () => {
    const html = renderMarkdown("![logo](https://images.example/logo.png)");
    expect(html).toContain('src="https://images.example/logo.png"');
    expect(html).not.toContain("data-local-image-path");
  });
});
