// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "../src/state/host-client.js";
import type { Session } from "../src/state/session.js";
import { addPending, applyNotification, initialThreadState, prependHistory, type ThreadItem, type ThreadViewState } from "../src/state/thread-reducer.js";
import { Transcript } from "../src/ui/TurnView.js";
import { clearUploadedImages } from "../src/ui/uploaded-image.js";

vi.mock("../src/ui/markdown.js", () => ({ renderMarkdown: (text: string) => text, handleCodeCopy: vi.fn() }));

const path = "/uploads/0123456789abcdef.png";
const userMessage = (imagePath = path): ThreadItem => ({
  type: "userMessage", id: "message-1", clientId: null,
  content: [{ type: "text", text: "Check this screenshot", text_elements: [] }, { type: "localImage", path: imagePath }],
});

let container: HTMLDivElement;
let root: Root;
let hosts: HostClient[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Blob(["image"], { type: "image/png" }))));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:screenshot");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  hosts = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const host of hosts) { host.dispose(); clearUploadedImages(host); }
  await Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sessionFor(id = "mac") {
  const host = new HostClient({ id, instanceId: id, name: id, origin: `https://${id}.ts.net`, token: `${id}-token`, deviceId: id, lastRoute: "#/", notifications: false });
  hosts.push(host);
  const readImageFile = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
  return { session: { host, readImageFile } as unknown as Session, readImageFile };
}

async function render(session: Session, view: ThreadViewState) {
  await act(async () => root.render(createElement(Transcript, { session, view, cwd: "/project" })));
}

function expectScreenshot(src: string) {
  expect(container.querySelector(".msg-images img")?.getAttribute("src")).toBe(src);
  expect(container.querySelector(".msg-image-name")).toBeNull();
  expect(container.textContent).toContain("Check this screenshot");
}

describe("user message images", () => {
  it("uses the paired computer for pending images and keeps the preview after Codex echoes the message", async () => {
    const { session, readImageFile } = sessionFor();
    const item = userMessage();
    if (item.type !== "userMessage") throw new Error("Expected a user message");
    const pending = addPending(initialThreadState("thread-1"), { id: "pending-1", input: item.content });
    await render(session, pending);
    expectScreenshot("blob:screenshot");
    expect(container.querySelector(".msg.pending")).not.toBeNull();
    const echoed = applyNotification(pending, { method: "item/started", params: { threadId: "thread-1", turnId: "turn-1", item } });
    await render(session, echoed);
    expectScreenshot("blob:screenshot");
    expect(container.querySelector(".msg.pending")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://mac.ts.net/api/uploads/0123456789abcdef.png");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer mac-token");
    expect(readImageFile).not.toHaveBeenCalled();
  });

  it("loads historical images and isolates the same path when switching computers", async () => {
    const view = prependHistory(initialThreadState("thread-1"), [{ turnId: "turn-1", item: userMessage() }]);
    vi.mocked(URL.createObjectURL).mockReturnValueOnce("blob:mac-a").mockReturnValueOnce("blob:mac-b");
    await render(sessionFor("mac-a").session, view);
    expectScreenshot("blob:mac-a");
    await render(sessionFor("mac-b").session, view);
    expectScreenshot("blob:mac-b");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "https://mac-a.ts.net/api/uploads/0123456789abcdef.png",
      "https://mac-b.ts.net/api/uploads/0123456789abcdef.png",
    ]);
  });

  it.each(["/project/screenshot.png", path])("reads %s through the session when the upload endpoint cannot serve it", async (imagePath) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    const { session, readImageFile } = sessionFor();
    const view = prependHistory(initialThreadState("thread-1"), [{ turnId: "turn-1", item: userMessage(imagePath) }]);
    await render(session, view);
    expectScreenshot("data:image/png;base64,AAAA");
    expect(readImageFile).toHaveBeenCalledWith(imagePath);
  });
});
