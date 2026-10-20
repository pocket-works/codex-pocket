/** Serialized into the opaque iframe; keep all dependencies inside this function. */
export function installVisualizationImages(baseUrl: string): () => void {
  interface Pending { id: string; url: string; images: Set<HTMLImageElement>; started: boolean; data?: string | null }
  const records = new Map<string, Pending>();
  const current = new WeakMap<HTMLImageElement, Pending>();
  const prefix = Math.random().toString(36).slice(2);
  const origin = new URL(baseUrl).origin;
  let active = 0;
  let scheduled = false;
  let animation = 0;
  const supportsIntersection = typeof IntersectionObserver !== "undefined";
  function priority(record: Pending): number {
    let best = Infinity;
    for (const image of record.images) {
      if (!image.isConnected || current.get(image) !== record) continue;
      if (!supportsIntersection) return 0;
      const rect = image.getBoundingClientRect();
      if ((!rect.width && !rect.height && !image.getClientRects().length) || rect.right < 0 || rect.left > window.innerWidth) continue;
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) return 0;
      const distance = rect.top > window.innerHeight ? rect.top - window.innerHeight : -rect.bottom;
      if (distance <= 400) best = Math.min(best, 1 + distance);
    }
    return best;
  }
  function pump() {
    scheduled = false;
    const candidates = Array.from(records.values())
      .filter((record) => !record.started && record.data === undefined)
      .map((record) => ({ record, priority: priority(record) }))
      .filter((item) => Number.isFinite(item.priority))
      .sort((a, b) => a.priority - b.priority);
    for (const { record } of candidates) {
      if (active >= 4) break;
      active++;
      load(record);
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    animation = window.requestAnimationFrame(pump);
  }
  // Recheck geometry when a slot frees: scroll events and observer callbacks may be delayed.
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  function apply(record: Pending, image: HTMLImageElement) {
    if (!image.isConnected || current.get(image) !== record || record.data === undefined) return;
    if (!record.data) { image.alt = (image.alt || "Image") + " (unavailable)"; return; }
    image.src = record.data;
    const anchor = image.closest("a");
    if (anchor && new URL(anchor.getAttribute("href") || "", baseUrl).href === record.url) {
      anchor.href = "#pocket-image";
      anchor.removeAttribute("target");
      anchor.dataset.previewImage = "";
    }
  }
  function load(record: Pending) {
    if (record.started) return;
    record.started = true;
    window.parent.postMessage({ type: "pocket/visualization/image", id: record.id, url: record.url }, "*");
  }
  const observer = supportsIntersection ? new IntersectionObserver(schedule, { rootMargin: "400px" }) : null;
  function inspect(image: HTMLImageElement) {
    const raw = image.getAttribute("src");
    if (!raw) return;
    let url: URL;
    try { url = new URL(raw, baseUrl); } catch { return; }
    if (url.origin !== origin) return;
    image.removeAttribute("src");
    image.removeAttribute("srcset");
    let record = records.get(url.href);
    if (!record) {
      if (records.size >= 128) { image.alt ||= "Too many images to preview"; return; }
      record = { id: prefix + records.size, url: url.href, images: new Set(), started: false };
      records.set(url.href, record);
    }
    current.set(image, record);
    record.images.add(image);
    if (record.data !== undefined) apply(record, image);
    else { observer?.observe(image); schedule(); }
  }
  function onMessage(event: MessageEvent) {
    const data = event.data;
    if (event.source !== window.parent || !data || data.type !== "pocket/visualization/image-result") return;
    const record = Array.from(records.values()).find((item) => item.id === data.id);
    if (!record || !record.started || record.data !== undefined) return;
    active--;
    record.data = typeof data.data === "string" && data.data.startsWith("data:image/") ? data.data : null;
    for (const image of record.images) {
      observer?.unobserve(image);
      apply(record, image);
    }
    schedule();
  }
  window.addEventListener("message", onMessage);
  const mutations = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target instanceof HTMLImageElement) inspect(mutation.target);
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) inspect(node);
        node.querySelectorAll<HTMLImageElement>("img[src]").forEach(inspect);
      }
    }
  });
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "srcset"] });
  document.querySelectorAll<HTMLImageElement>("img[src]").forEach(inspect);
  return () => {
    mutations.disconnect();
    observer?.disconnect();
    window.cancelAnimationFrame(animation);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
  };
}
