// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installVisualizationImages } from "../src/ui/visualization-image-runtime.js";
import { prepareVisualization } from "../src/ui/visualization.js";

let dispose = () => {};

afterEach(() => { dispose(); dispose = () => {}; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("gallery first render", () => {
  it("prepares a 103-image gallery without embedding image data or waiting for files", () => {
    const gallery = Array.from({ length: 103 }, (_, i) => `<a href="desktop/${i}.png"><img src="desktop/${i}.png"></a>`).join("");
    const source = prepareVisualization(gallery, "/gallery/desktop.html");
    const parsed = new DOMParser().parseFromString(source, "text/html");
    expect(parsed.querySelectorAll('img[loading="lazy"]')).toHaveLength(103);
    expect(source.length).toBeLessThan(50_000);
    expect(source).not.toContain("base64,");
    expect(parsed.querySelector("a")!.getAttribute("href")).toBe("https://pocket.invalid/gallery/desktop/0.png");
  });

  it("reads only intersecting static images and reuses their source for image links", async () => {
    let intersect!: IntersectionObserverCallback;
    const observe = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe = observe;
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    document.body.innerHTML = '<a href="desktop/1.png"><img loading="lazy" src="desktop/1.png"></a><img loading="lazy" src="desktop/2.png">';
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const send = vi.spyOn(window.parent, "postMessage");
    dispose = installVisualizationImages("https://pocket.invalid/gallery/desktop.html");
    await Promise.resolve();
    expect(observe).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    const image = document.querySelector("img")!;
    // An image without dimensions still has a layout box before its source is loaded.
    const rect = { top: 10, bottom: 10, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect);
    vi.spyOn(image, "getClientRects").mockReturnValue([rect] as unknown as DOMRectList);
    vi.spyOn(document.querySelectorAll("img")[1], "getBoundingClientRect").mockReturnValue({ top: 10000, bottom: 10100, left: 0, right: 100, width: 100, height: 100 } as DOMRect);
    intersect([{ isIntersecting: true, target: image }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    frames.shift()!(0);
    expect(send).toHaveBeenCalledTimes(1);
    const request = send.mock.calls[0][0] as { id: string; url: string };
    expect(request.url).toBe("https://pocket.invalid/gallery/desktop/1.png");
    window.dispatchEvent(new MessageEvent("message", { source: window.parent, data: { type: "pocket/visualization/image-result", id: request.id, data: "data:image/png;base64,AAAA" } }));
    expect(image.src).toBe("data:image/png;base64,AAAA");
    expect(document.querySelector("a")!.getAttribute("data-preview-image")).toBe("");
    expect(document.querySelectorAll('img[src]')).toHaveLength(1);
  });

  it("prioritizes the new viewport over earlier nearby images and pauses images scrolled away", () => {
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.push(callback); return frames.length; });
    document.body.innerHTML = Array.from({ length: 7 }, (_, i) => `<img loading="lazy" src="${i}.png">`).join("");
    const tops = [100, 200, 300, 400, 900, 10000, 11000];
    document.querySelectorAll("img").forEach((image, i) => {
      vi.spyOn(image, "getBoundingClientRect").mockImplementation(() => ({ top: tops[i], bottom: tops[i] + 100, left: 0, right: 100, width: 100, height: 100 }) as DOMRect);
    });
    const send = vi.spyOn(window.parent, "postMessage");
    const reply = (index: number) => {
      const request = send.mock.calls[index][0] as { id: string };
      window.dispatchEvent(new MessageEvent("message", { source: window.parent, data: { type: "pocket/visualization/image-result", id: request.id, data: "data:image/png;base64,AAAA" } }));
    };
    dispose = installVisualizationImages("https://pocket.invalid/gallery/index.html");
    frames.shift()!(0);
    expect(send).toHaveBeenCalledTimes(4);
    // A fast scroll skips the earlier prefetch candidate before a slot becomes free.
    tops[4] = -10000;
    tops[5] = 100;
    reply(1);
    frames.shift()!(0);
    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls[4][0]).toMatchObject({ url: "https://pocket.invalid/gallery/5.png" });
    reply(0);
    frames.shift()!(0);
    expect(send).toHaveBeenCalledTimes(5);
    // An offscreen image remains eligible when the user later scrolls back to it.
    tops[4] = 100;
    tops[6] = 900;
    window.dispatchEvent(new Event("scroll"));
    frames.shift()!(0);
    expect(send).toHaveBeenCalledTimes(6);
    expect(send.mock.calls[5][0]).toMatchObject({ url: "https://pocket.invalid/gallery/4.png" });
    reply(2);
    frames.shift()!(0);
    expect(send.mock.calls[6][0]).toMatchObject({ url: "https://pocket.invalid/gallery/6.png" });
  });

});
