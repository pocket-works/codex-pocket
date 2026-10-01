import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutSheet } from "../src/ui/AboutSheet.js";

describe("About", () => {
  it("shows the loaded phone app version without needing a computer connection", () => {
    const html = renderToStaticMarkup(createElement(AboutSheet, { onClose: () => {} }));
    expect(import.meta.env.VITE_APP_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
    expect(html).toContain(`Phone app version</span><span class="setting-value muted">${import.meta.env.VITE_APP_VERSION}</span>`);
    expect(html).toContain("Codex Pocket</h3>");
  });
});
