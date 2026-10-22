export const VISUALIZATION_IMAGE_ORIGIN = "https://pocket.invalid";
const IMAGE = /\.(?:png|jpe?g|gif|webp|heic|bmp|svg)$/i;

export function visualizationImageBase(path: string): string {
  return new URL(path.split("/").map(encodeURIComponent).join("/"), VISUALIZATION_IMAGE_ORIGIN).href;
}

/** Only images below this HTML page's directory may cross the sandbox boundary. */
export function visualizationImagePath(source: unknown, pagePath: string): string | null {
  if (typeof source !== "string" || source.length > 8192) return null;
  try {
    const url = new URL(source, visualizationImageBase(pagePath));
    if (url.origin !== VISUALIZATION_IMAGE_ORIGIN || url.username || url.password) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (/[\u0000-\u001f\\]/.test(decoded)) return null;
    const parts: string[] = [];
    for (const part of decoded.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    const path = "/" + parts.join("/");
    const directory = decodeURIComponent(new URL(".", visualizationImageBase(pagePath)).pathname);
    return path.startsWith(directory) && IMAGE.test(path) ? path : null;
  } catch { return null; }
}

/** Deduplicate reads, cap each preview, and keep at most four file requests active. */
export function visualizationImageLoader(pagePath: string, read: (path: string) => Promise<string | null>): (source: unknown) => Promise<string | null> {
  const images = new Map<string, Promise<string | null>>();
  const queue: Array<() => void> = [];
  let active = 0;
  function drain() {
    while (active < 4 && queue.length) queue.shift()!();
  }
  return (source) => {
    const path = visualizationImagePath(source, pagePath);
    if (!path) return Promise.resolve(null);
    const existing = images.get(path);
    if (existing) return existing;
    if (images.size >= 128) return Promise.resolve(null);
    const pending = new Promise<string | null>((resolve) => {
      queue.push(() => {
        active++;
        void Promise.resolve().then(() => read(path)).catch(() => null).then((data) => {
          active--;
          resolve(data);
          drain();
        });
      });
    });
    drain();
    images.set(path, pending);
    return pending;
  };
}
