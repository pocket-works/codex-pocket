import type { TokenizerAndRendererExtension } from "marked";

const CITATION = /^:codex-file-citation\{path="([^"\n]+\.pdf)"(?:\s+purpose="[^"\n]*")?\}/i;
const LOCAL_PATH_ROOTS = ["/Users/", "/tmp/", "/private/", "/Volumes/"];

export function localFilePath(href: string, baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
    if (url.origin !== new URL(baseUrl).origin) return null;
    const path = decodeURIComponent(url.pathname);
    return LOCAL_PATH_ROOTS.some((root) => path.startsWith(root)) ? path : null;
  } catch {
    return null;
  }
}

export function localPdfPath(href: string, baseUrl: string): string | null {
  const path = localFilePath(href, baseUrl);
  return path && path.toLowerCase().endsWith(".pdf") ? path : null;
}

export function localImagePath(href: string, baseUrl: string): string | null {
  const path = localFilePath(href, baseUrl);
  return path && /\.(?:png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(path) ? path : null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// An inline extension leaves fenced and inline code untouched.
export const pdfCitation: TokenizerAndRendererExtension = {
  name: "pdfCitation",
  level: "inline",
  start: (src) => src.indexOf(":codex-file-citation{"),
  tokenizer(src) {
    const match = CITATION.exec(src);
    return match ? { type: "pdfCitation", raw: match[0], path: match[1] } : undefined;
  },
  renderer(token) {
    const path = token.path as string;
    const name = path.slice(path.lastIndexOf("/") + 1);
    return `<button type="button" class="file-citation" data-pdf-path="${escapeAttribute(path)}" title="Open ${escapeAttribute(name)}"><span class="file-citation-icon" aria-hidden="true">PDF</span><span>${escapeAttribute(name)}</span></button>`;
  },
};
