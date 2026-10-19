// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/state/session.js";
import { initialThreadState, prependHistory } from "../src/state/thread-reducer.js";
import { Transcript } from "../src/ui/TurnView.js";

vi.mock("../src/ui/PdfPages.js", () => ({ PdfPages: () => null }));

let container: HTMLDivElement;
let root: Root;
const notify = vi.fn();
const readImageFile = vi.fn();
const readTextFile = vi.fn();
const readPdfFile = vi.fn();
const session = { notify, readImageFile, readTextFile, readPdfFile, store: { get: () => ({ open: { cwd: "/Projects/pocket" } }) } } as unknown as Session;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const browser = (window as unknown as { happyDOM: { setURL(url: string): void; settings: { handleDisabledFileLoadingAsSuccess: boolean } } }).happyDOM;
  browser.setURL("https://pocket.example/");
  // Real script execution and CSP are checked in a browser, not Happy DOM.
  browser.settings.handleDisabledFileLoadingAsSuccess = true;
  readImageFile.mockReset().mockResolvedValue("data:image/png;base64,AAAA");
  readTextFile.mockReset().mockResolvedValue("export const answer = 42;\n");
  readPdfFile.mockReset();
  notify.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.scrollTo = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(text: string) {
  const view = prependHistory(initialThreadState("thread"), [{ turnId: "turn", item: {
    type: "agentMessage", id: "answer", text, phase: text.startsWith("## ") ? "final_answer" : null,
    memoryCitation: null, delivery: null, questions: null,
  } }]);
  await act(async () => root.render(createElement(Transcript, { session, view, cwd: "/Projects/pocket" })));
}

async function click(selector: string) {
  const target = container.querySelector<HTMLElement>(selector);
  expect(target).not.toBeNull();
  await act(async () => target!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

describe("rendered link actions", () => {
  it("opens visualize references through the paired computer in an isolated frame", async () => {
    readTextFile.mockResolvedValue('<button onclick="this.textContent=42">Calculate</button><script>window.ready = true;</script>');
    await render('visualize{"path":"/Users/test/chart.html","title":"Explore chart","mode":"wide"}');
    expect(readTextFile).not.toHaveBeenCalled();
    expect(container.querySelector(".visualization-card")!.textContent).toContain("Explore chart");
    await click(".visualization-card");
    expect(readTextFile).toHaveBeenCalledWith("/Users/test/chart.html");
    const frame = document.querySelector<HTMLIFrameElement>(".visualization-frame")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.srcdoc).toContain('onclick="this.textContent=42"');
    expect(frame.srcdoc).toContain("connect-src 'none'");
    expect(frame.srcdoc).toContain("base-uri 'none'");
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close visualization"]')!.click());
    expect(document.querySelector(".visualization-viewer")).toBeNull();
  });

  it("shows file read errors and retries a visualization", async () => {
    readTextFile.mockRejectedValueOnce(new Error("Computer offline")).mockResolvedValueOnce("<div>Chart</div>");
    await render('visualize{"path":"/tmp/chart.html"}');
    await click(".visualization-card");
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("Computer offline");
    await act(async () => document.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(readTextFile).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".visualization-frame")).not.toBeNull();
  });

  it.each([
    "/Users/test/.codex/visualizations/gallery/index.html",
    "https://pocket.example/Users/test/.codex/visualizations/gallery/index.html",
  ])("renders an ordinary local HTML link and its sibling images: %s", async (href) => {
    readTextFile.mockResolvedValue('<!doctype html><html><head><title>Gallery</title></head><body><h1>Design review</h1><a href="screen.png"><img src="screen.png" srcset="screen.png 2x" alt="Mobile design"></a><script>window.galleryReady=true;</script></body></html>');
    await render(`[Gallery](${href})`);
    await click(".final-text a");
    expect(readTextFile).toHaveBeenCalledWith("/Users/test/.codex/visualizations/gallery/index.html");
    expect(readImageFile).toHaveBeenCalledWith("/Users/test/.codex/visualizations/gallery/screen.png");
    expect(document.querySelector(".linked-file-viewer")).toBeNull();
    const source = document.querySelector<HTMLIFrameElement>(".visualization-frame")!.srcdoc;
    expect(source).toContain("<h1>Design review</h1>");
    expect(source).toContain('src="data:image/png;base64,AAAA"');
    expect(source).toContain('data-preview-image="data:image/png;base64,AAAA"');
    expect(source).not.toContain("srcset=");
    expect(source).toContain("window.galleryReady=true;");
  });

  it("keeps code examples and invalid visualize paths inert", async () => {
    await render('`visualize{"path":"/tmp/chart.html"}`\n\n```text\nvisualize{"path":"/tmp/chart.html"}\n```\n\nvisualize{"path":"https://example.com/chart.html"}\n\nvisualize{"path":"/tmp/secrets.json"}\n\nvisualize{bad json}');
    expect(container.querySelector(".visualization-card")).toBeNull();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it("escapes visualize titles and paths without adding executable markup", async () => {
    await render('visualize' + JSON.stringify({ path: '/tmp/" onclick="alert(1).html', title: '<img src=x onerror="alert(1)">' }) + '');
    const card = container.querySelector<HTMLButtonElement>(".visualization-card")!;
    expect(card.dataset.visualizationPath).toBe('/tmp/" onclick="alert(1).html');
    expect(card.hasAttribute("onclick")).toBe(false);
    expect(card.querySelector("img")).toBeNull();
  });

  it("rejects oversized visualization files", async () => {
    readTextFile.mockResolvedValue("中".repeat(400_000));
    await render('visualize{"path":"/tmp/large.html"}');
    await click(".visualization-card");
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("1 MB");
    expect(document.querySelector(".visualization-frame")).toBeNull();
  });

  it("keeps web links on the browser path", async () => {
    await render("[Open](https://example.com/docs)");
    const link = container.querySelector<HTMLAnchorElement>(".final-text a")!;
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.dataset.pocketLink).toBeUndefined();
  });

  it("navigates Pocket routes without opening another tab", async () => {
    await render("[Thread](#/t/another-thread)");
    const link = container.querySelector<HTMLAnchorElement>(".final-text a")!;
    expect(link.hasAttribute("target")).toBe(false);
    await click(".final-text a");
    expect(location.hash).toBe("#/t/another-thread");
  });

  it("keeps fragment links in the message", async () => {
    await render("[Details](#more-details)");
    expect(container.querySelector<HTMLAnchorElement>(".final-text a")!.hasAttribute("target")).toBe(false);
  });

  it("opens a linked local image in the image viewer", async () => {
    await render("[Screenshot](/Users/test/screenshot.png)");
    await click(".final-text a");
    expect(readImageFile).toHaveBeenCalledWith("/Users/test/screenshot.png");
    expect(document.querySelector(".image-viewer")).not.toBeNull();
  });

  it("opens a linked local text file in a readable preview", async () => {
    await render("[Source](src/session.ts)");
    await click(".final-text a");
    expect(readTextFile).toHaveBeenCalledWith("/Projects/pocket/src/session.ts");
    expect(document.querySelector(".linked-file-viewer")!.textContent).toContain("export const answer");
  });

  it("explains unsupported protocols instead of navigating nowhere", async () => {
    await render("[Editor](vscode://file/Users/test/a.ts)");
    const link = container.querySelector<HTMLAnchorElement>(".final-text a")!;
    expect(link.hasAttribute("href")).toBe(false);
    await click(".final-text a");
    expect(notify).toHaveBeenCalledWith("This link uses a protocol this phone cannot open.");
  });

  it("removes executable URLs before they enter the document", async () => {
    await render("[Bad](javascript:alert(1))");
    const link = container.querySelector<HTMLAnchorElement>(".final-text a")!;
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.dataset.pocketLink).toBe("unsafe");
  });
});
