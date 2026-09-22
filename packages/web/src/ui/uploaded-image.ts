import { useEffect, useState } from "react";
import { getToken } from "../state/auth.js";
import type { Session } from "../state/session.js";

// Images the phone attached are files in the host's uploads folder; the host
// serves those (and only those) back by name. Anything else — a screenshot
// Codex took, an image the desktop attached — is a path on the Mac, read
// through Codex's own `fs/readFile`.
const UPLOAD_NAME = /^[0-9a-f]{16}\.(jpg|png|webp|gif|heic)$/;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** The image type a path promises by its extension, or null when it is not an image. */
export function imageMimeType(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_TYPES[ext] ?? null;
}

const cache = new Map<string, Promise<string | null>>();

/** Object URL for an image the phone uploaded, or null when it is not one of ours (or failed to load). */
export function uploadedImageUrl(path: string): Promise<string | null> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!UPLOAD_NAME.test(name)) return Promise.resolve(null);
  let p = cache.get(path);
  if (!p) {
    p = fetch(`/api/uploads/${name}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } })
      .then((res) => (res.ok ? res.blob().then((b) => URL.createObjectURL(b)) : null))
      .catch(() => null);
    cache.set(path, p);
  }
  return p;
}

export function useUploadedImage(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    void uploadedImageUrl(path).then((u) => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

/**
 * Any image on the Mac by absolute path: an upload when it is one of ours,
 * otherwise read off disk. `null` while it loads and when it cannot be read.
 */
export function useLocalImage(session: Session, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (path === null) return;
    let live = true;
    void uploadedImageUrl(path)
      .then((u) => u ?? session.readImageFile(path))
      .catch(() => null)
      .then((u) => {
        if (live) setUrl(u);
      });
    return () => {
      live = false;
    };
  }, [path, session]);
  return url;
}
