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
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://pocket.example/");
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
