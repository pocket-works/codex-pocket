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
const path = "/Users/test/output/清华池.pdf";
const pdf = new Blob(["%PDF-1.7"], { type: "application/pdf" });
const readPdfFile = vi.fn();
const notify = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://pocket.example/");
  readPdfFile.mockReset().mockResolvedValue(pdf);
  notify.mockReset();
  createObjectURL.mockReset().mockReturnValue("blob:pdf-download");
  revokeObjectURL.mockReset();
  vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
  container = document.createElement("div");
  container.style.overflow = "hidden";
  container.style.transform = "translateX(20px)";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(text: string) {
  const session = { readPdfFile, notify } as unknown as Session;
  const view = prependHistory(initialThreadState("thread"), [{ turnId: "turn", item: {
    type: "agentMessage", id: "answer", text, phase: "final_answer",
    memoryCitation: null, delivery: null, questions: null,
  } }]);
  await act(async () => root.render(createElement(Transcript, { session, view, cwd: "/project" })));
}

describe("PDF previews from the transcript", () => {
  it.each([
    `:codex-file-citation{path="${path}" purpose="output"}`,
    `[Report](${path})`,
  ])("opens the PDF with a download action inside the preview: %s", async (text) => {
    await render(text);
    expect(container.textContent).not.toContain("Download");
    const trigger = container.querySelector<HTMLElement>(".final-text .file-citation, .final-text a")!;
    await act(async () => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(readPdfFile).toHaveBeenCalledExactlyOnceWith(path);
    expect(createObjectURL).toHaveBeenCalledWith(pdf);
    const viewer = document.querySelector<HTMLElement>(".pdf-viewer")!;
    expect(viewer).not.toBeNull();
    expect(container.contains(viewer)).toBe(false);
    expect(viewer.closest(".pdf-viewer-backdrop")?.parentElement).toBe(document.body);
    const download = viewer.querySelector<HTMLAnchorElement>(".pdf-download");
    expect(download?.download).toBe("清华池.pdf");
    expect(download?.href).toBe("blob:pdf-download");
    await act(async () => viewer.querySelector<HTMLButtonElement>('[aria-label="Close PDF preview"]')!.click());
    expect(document.querySelector(".pdf-viewer")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pdf-download");
  });

  it("reports a failed read and allows retrying the preview", async () => {
    readPdfFile.mockRejectedValueOnce(new Error("File not found"));
    await render(`:codex-file-citation{path="${path}" purpose="output"}`);
    const trigger = container.querySelector<HTMLButtonElement>(".file-citation")!;
    await act(async () => trigger.click());
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("File not found"));
    expect(trigger.disabled).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    await act(async () => trigger.click());
    expect(readPdfFile).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".pdf-viewer")).not.toBeNull();
  });
});
