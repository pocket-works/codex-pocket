// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/state/session.js";
import { initialThreadState, prependHistory } from "../src/state/thread-reducer.js";
import { PreviewImage } from "../src/ui/ImagePreview.js";
import { Transcript } from "../src/ui/TurnView.js";

let container: HTMLDivElement;
let root: Root;
const src = "data:image/png;base64,AAAA";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  container.className = "items";
  container.style.overflow = "hidden";
  container.style.transform = "translateX(20px)";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull();
  await act(async () => element!.click());
}

function viewer() {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Screenshot"]');
}

describe("image previews in a scrolling transcript", () => {
  it.each(["close button", "background", "Escape"])("closes with %s and returns focus to the thumbnail", async (method) => {
    await act(async () => root.render(createElement(PreviewImage, { src, alt: "Screenshot" })));
    const trigger = container.querySelector<HTMLButtonElement>(".image-preview-trigger")!;
    trigger.focus();
    await click(trigger);
    expect(viewer()).not.toBeNull();
    expect(container.contains(viewer())).toBe(false);
    expect(viewer()?.closest(".image-viewer-backdrop")?.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(viewer());
    // Looking at the image must not dismiss the preview.
    await click(viewer()!.querySelector("img"));
    expect(viewer()).not.toBeNull();
    if (method === "close button") {
      await click(viewer()!.querySelector('[aria-label="Close image preview"]'));
    } else if (method === "background") {
      await click(viewer()!.querySelector(".image-viewer-content"));
    } else {
      await act(async () => viewer()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    }
    expect(viewer()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps preview touches and dismissal clicks out of the transcript's back gesture", async () => {
    const onTouch = vi.fn();
    const onClick = vi.fn();
    await act(async () => root.render(createElement("div", {
      onTouchStart: onTouch, onTouchMove: onTouch, onTouchEnd: onTouch, onTouchCancel: onTouch, onClick,
    }, createElement(PreviewImage, { src, alt: "Screenshot" }))));
    await click(container.querySelector(".image-preview-trigger"));
    onClick.mockClear();
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      await act(async () => viewer()!.querySelector("img")!.dispatchEvent(new Event(type, { bubbles: true })));
    }
    expect(onTouch).not.toHaveBeenCalled();
    await click(viewer()!.closest(".image-viewer-backdrop") as HTMLElement);
    expect(viewer()).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens and closes a local Markdown screenshot from a final answer", async () => {
    const readImageFile = vi.fn().mockResolvedValue(src);
    const session = { readImageFile } as unknown as Session;
    const view = prependHistory(initialThreadState("thread"), [{ turnId: "turn", item: {
      type: "agentMessage", id: "answer", text: "![Screenshot](/tmp/published.png)", phase: "final_answer",
      memoryCitation: null, delivery: null, questions: null,
    } }]);
    await act(async () => root.render(createElement(Transcript, { session, view, cwd: "/project" })));
    expect(readImageFile).toHaveBeenCalledWith("/tmp/published.png");
    const image = container.querySelector<HTMLImageElement>(".final-text img")!;
    expect(image.src).toBe(src);
    await click(image);
    expect(viewer()?.querySelector("img")?.src).toBe(src);
    expect(container.contains(viewer())).toBe(false);
    await click(viewer()!.querySelector('[aria-label="Close image preview"]'));
    expect(viewer()).toBeNull();
    expect(image.isConnected).toBe(true);
  });
});
