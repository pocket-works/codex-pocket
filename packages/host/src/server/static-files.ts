import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

// Serve a built single-page app: real files as-is, everything else falls
// back to index.html so client-side routes deep-link correctly.
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  const rootAbs = resolve(root);
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = normalize(join(rootAbs, urlPath));
  if (!file.startsWith(rootAbs + sep) && file !== rootAbs) {
    res.writeHead(403).end();
    return true;
  }
  if (!isFile(file)) file = join(rootAbs, "index.html");
  if (!isFile(file)) return false;
  const ext = extname(file);
  // Only Vite's hashed bundles may be cached forever; icons, the manifest
  // and the service worker keep their names, so they must revalidate.
  const immutable = urlPath.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
  return true;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
