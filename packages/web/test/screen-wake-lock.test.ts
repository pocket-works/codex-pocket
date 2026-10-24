// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { keepScreenAwake } from "../src/state/screen-wake-lock.js";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sentinel() {
  return { released: false, release: vi.fn().mockResolvedValue(undefined) };
}

function fixture() {
  const lock = sentinel();
  const request = vi.fn().mockResolvedValue(lock);
  vi.stubGlobal("navigator", { wakeLock: { request } });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  return { lock, request };
}

async function visibility(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
}

describe("dictation screen wake lock", () => {
  it("holds the screen awake until stopped, then removes the visibility listener", async () => {
    const { lock, request } = fixture();
    stop = keepScreenAwake();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");
    expect(lock.release).not.toHaveBeenCalled();
    stop();
    stop();
    expect(lock.release).toHaveBeenCalledTimes(1);
    await visibility("visible");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reacquires a browser-released lock when the page returns to the foreground", async () => {
    const { lock, request } = fixture();
    stop = keepScreenAwake();
    await Promise.resolve();
    await visibility("visible");
    expect(request).toHaveBeenCalledTimes(1);
    await visibility("hidden");
    lock.released = true;
    const next = sentinel();
    request.mockResolvedValue(next);
    await visibility("visible");
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    expect(next.release).toHaveBeenCalledTimes(1);
  });

  it("releases a request that resolves after dictation stops without acquiring duplicates", async () => {
    const { lock, request } = fixture();
    let resolve!: (value: typeof lock) => void;
    request.mockReturnValue(new Promise((r) => { resolve = r; }));
    stop = keepScreenAwake();
    await visibility("visible");
    expect(request).toHaveBeenCalledTimes(1);
    stop();
    resolve(lock);
    await Promise.resolve();
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("releases a request that resolves in the background and retries on return", async () => {
    const { lock, request } = fixture();
    let resolve!: (value: typeof lock) => void;
    request.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    stop = keepScreenAwake();
    await visibility("hidden");
    resolve(lock);
    await Promise.resolve();
    expect(lock.release).toHaveBeenCalledTimes(1);
    await visibility("visible");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("waits until the page is visible before requesting a lock", async () => {
    const { request } = fixture();
    await visibility("hidden");
    stop = keepScreenAwake();
    expect(request).not.toHaveBeenCalled();
    await visibility("visible");
    expect(request).toHaveBeenCalledWith("screen");
  });

  it("tolerates unavailable APIs and rejected requests or releases", async () => {
    vi.stubGlobal("navigator", {});
    expect(keepScreenAwake()()).toBeUndefined();
    const { lock, request } = fixture();
    request.mockRejectedValueOnce(new Error("Power saving"));
    stop = keepScreenAwake();
    await Promise.resolve();
    await visibility("hidden");
    await visibility("visible");
    expect(request).toHaveBeenCalledTimes(2);
    lock.release.mockRejectedValue(new Error("Already released"));
    stop();
    await Promise.resolve();
  });
});
