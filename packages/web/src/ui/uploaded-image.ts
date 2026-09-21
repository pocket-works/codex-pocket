import { useEffect, useState } from "react";
import { getToken } from "../state/auth.js";

// Images the phone attached are files in the host's uploads folder; the host
// serves those (and only those) back by name. Anything else a `localImage`
// points at is a path on the Mac we cannot show.
const UPLOAD_NAME = /^[0-9a-f]{16}\.(jpg|png|webp|gif|heic)$/;

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
