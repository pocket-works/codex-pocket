import { describe, expect, it } from "vitest";
import { classifyLink, fileKind } from "../src/ui/file-citation.js";

const base = "https://pocket.example/";

describe("link routing", () => {
  it("keeps Pocket routes and page fragments inside the app", () => {
    expect(classifyLink("#/t/thread?subagents=1", base)).toEqual({ kind: "internal", hash: "#/t/thread?subagents=1" });
    expect(classifyLink("#usage", base)).toEqual({ kind: "fragment", hash: "#usage" });
    expect(classifyLink("https://pocket.example/#/t/thread", base)).toEqual({ kind: "internal", hash: "#/t/thread" });
    expect(classifyLink("https://pocket.example/#usage", base)).toEqual({ kind: "fragment", hash: "#usage" });
  });

  it("treats ordinary websites and same-origin pages as browser links", () => {
    expect(classifyLink("https://developers.openai.com/", base)).toEqual({ kind: "web", url: "https://developers.openai.com/" });
    expect(classifyLink("/manual.pdf", base)).toEqual({ kind: "web", url: "https://pocket.example/manual.pdf" });
    expect(classifyLink("docs.html", base, "/Projects/pocket")).toEqual({ kind: "web", url: "https://pocket.example/docs.html" });
  });

  it("resolves relative answer paths beside the thread's workspace", () => {
    expect(classifyLink("src/session.ts", base, "/Projects/pocket")).toEqual({ kind: "file", path: "/Projects/pocket/src/session.ts" });
    expect(classifyLink("../README.md", base, "/Projects/pocket/web")).toEqual({ kind: "file", path: "/Projects/pocket/README.md" });
    expect(classifyLink("./docs/a%20report.pdf", base, "/Projects/pocket")).toEqual({ kind: "file", path: "/Projects/pocket/docs/a report.pdf" });
    expect(classifyLink("report.pdf", base, "/Projects/pocket")).toEqual({ kind: "file", path: "/Projects/pocket/report.pdf" });
    expect(classifyLink("chart.png", base, "/Projects/pocket")).toEqual({ kind: "file", path: "/Projects/pocket/chart.png" });
  });

  it("recognizes absolute host paths and file URLs as computer files", () => {
    expect(classifyLink("/Users/test/a.pdf", base)).toEqual({ kind: "file", path: "/Users/test/a.pdf" });
    expect(classifyLink("file:///home/test/a.png", base)).toEqual({ kind: "file", path: "/home/test/a.png" });
    expect(classifyLink("https://pocket.example/tmp/capture.webp", base)).toEqual({ kind: "file", path: "/tmp/capture.webp" });
    expect(classifyLink("/home/test/a.ts", base)).toEqual({ kind: "file", path: "/home/test/a.ts" });
  });

  it("hands known system protocols to the operating system", () => {
    expect(classifyLink("mailto:test@example.com", base)).toEqual({ kind: "system", url: "mailto:test@example.com" });
    expect(classifyLink("tel:+86123", base)).toEqual({ kind: "system", url: "tel:+86123" });
    expect(classifyLink("sms:+86123", base)).toEqual({ kind: "system", url: "sms:+86123" });
  });

  it("separates unrecognized protocols from dangerous ones", () => {
    expect(classifyLink("vscode://file/Users/test/a.ts", base)).toEqual({ kind: "unsupported", url: "vscode://file/Users/test/a.ts" });
    expect(classifyLink("javascript:alert(1)", base)).toEqual({ kind: "unsafe" });
    expect(classifyLink("data:text/html,hi", base)).toEqual({ kind: "unsafe" });
  });

  it("classifies file destinations by extension", () => {
    expect(fileKind("/tmp/report.pdf")).toBe("pdf");
    expect(fileKind("/tmp/chart.HEIC")).toBe("image");
    expect(fileKind("/tmp/session.ts")).toBe("text");
    expect(fileKind("/tmp/archive.zip")).toBe("unknown");
  });
});
