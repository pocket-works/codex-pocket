import type { TokenizerAndRendererExtension } from "marked";

const CITATION = /^:codex-file-citation\{path="([^"\n]+\.pdf)"(?:\s+purpose="[^"\n]*")?\}/i;
const HOST_PATH = /^\/(?:Users|tmp|private|Volumes|home|root|project|workspace|srv|opt|var|mnt)\//;
const APP_ASSET = /^\/(?:assets|splash|push)\/|^\/(?:icon(?:-\d+)?\.(?:png|svg)|manifest\.webmanifest|sw\.js|push-worker\.js|favicon\.ico)$/;
const FILE_EXTENSION = /\.(?:pdf|html?|xml|txt|md|markdown|csv|json|ya?ml|toml|log|sh|zsh|bash|css|jsx?|mjs|cjs|tsx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|png|jpe?g|gif|webp|heic|bmp|svg|zip|tar|gz|tgz|7z|rar|mp3|wav|m4a|mp4|mov|webm)$/i;

export type LinkAction =
  | { kind: "fragment"; hash: string }
  | { kind: "embedded" }
  | { kind: "internal"; hash: string }
  | { kind: "web"; url: string }
  | { kind: "system"; url: string }
  | { kind: "file"; path: string }
  | { kind: "unsupported"; url: string }
  | { kind: "unsafe" };

/** Browser protocols that are safe to hand to the operating system. */
const SYSTEM_PROTOCOLS = new Set(["mailto:", "tel:", "sms:"]);
/** The PWA itself can open these as documents, but cannot preview them locally. */
const EMBEDDED_EXTENSIONS = /\.(?:html?|xml|txt|md|markdown|csv|json|ya?ml|toml|log|sh|zsh|bash|css|jsx?|mjs|cjs|tsx?|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|pdf|png|jpe?g|gif|webp|heic|bmp|svg)$/i;

export function localFilePath(href: string, baseUrl: string, cwd?: string): string | null {
  const action = classifyLink(href, baseUrl, cwd);
  return action.kind === "file" ? action.path : null;
}

export function localPdfPath(href: string, baseUrl: string, cwd?: string): string | null {
  const path = localFilePath(href, baseUrl, cwd);
  return path && path.toLowerCase().endsWith(".pdf") ? path : null;
}

export function localImagePath(href: string, baseUrl: string, cwd?: string): string | null {
  const path = localFilePath(href, baseUrl, cwd);
  return path && /\.(?:png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(path) ? path : null;
}

function absolutePath(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return path.startsWith("/") ? path : null;
}

/**
 * Decide where a rendered Markdown link goes. This is deliberately pure:
 * the same result feeds target attributes and the click handler, so a link
 * cannot be classified one way in the DOM and another way when tapped.
 */
export function classifyLink(href: string, baseUrl: string, cwd?: string): LinkAction {
  const raw = href.trim();
  if (!raw) return { kind: "unsafe" };
  if (raw.startsWith("#/")) return { kind: "internal", hash: raw };
  if (raw.startsWith("#")) return { kind: "fragment", hash: raw };

  // A document-relative hash link stays in the Pocket page.
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return { kind: "unsafe" };
  }
  try {
    // Repo-style relative links in an answer point at files beside the
    // conversation, not at Pocket's static server.
    if (cwd && isRelativeFile(raw)) {
      const clean = raw.split(/[?#]/, 1)[0];
      try {
        return { kind: "file", path: resolveRelative(cwd, decodeURIComponent(clean)) };
      } catch {
        return { kind: "unsafe" };
      }
    }
    const url = new URL(raw, base);
    if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "vbscript:") {
      return { kind: "unsafe" };
    }
    if (url.protocol === "file:") {
      let path: string;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return { kind: "unsafe" };
      }
      return path.startsWith("/") ? { kind: "file", path } : { kind: "unsupported", url: raw };
    }
    if (SYSTEM_PROTOCOLS.has(url.protocol)) return { kind: "system", url: url.href };
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { kind: "unsupported", url: raw };
    }

    // Hash links point at the same document, not at a new browser tab.
    if (url.origin === base.origin && url.hash.startsWith("#/")) {
      return { kind: "internal", hash: url.hash };
    }
    if (url.origin === base.origin && url.pathname === base.pathname && url.search === base.search && url.hash) {
      return { kind: "fragment", hash: url.hash };
    }
    // Same-origin, absolute-looking paths can name files on the paired host.
    // Keep ordinary Pocket assets on the web path instead of treating them
    // as computer files.
    if (url.origin === base.origin) {
      const path = absolutePath(url.pathname);
      if (path && HOST_PATH.test(path)) {
        return { kind: "file", path };
      }
      if (path && APP_ASSET.test(path)) return { kind: "embedded" };
      if (cwd && raw.startsWith("/") && path && FILE_EXTENSION.test(path)) {
        // A leading slash without a known host root may be an absolute file
        // path in the current workspace, as Codex often emits for outputs.
        return { kind: "file", path };
      }
      return { kind: "web", url: url.href };
    }
    return { kind: "web", url: url.href };
  } catch {
    return { kind: "unsafe" };
  }
}

function isRelativeFile(raw: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/")) return false;
  const clean = raw.split(/[?#]/, 1)[0];
  if (raw.startsWith("./") || raw.startsWith("../")) return FILE_EXTENSION.test(clean);
  return /\.(?:pdf|tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|md|markdown|json|ya?ml|toml|sh|zsh|bash|csv|log|txt|png|jpe?g|gif|webp|heic|bmp|svg|zip|tar|gz|tgz|7z|rar|mp3|wav|m4a|mp4|mov|webm)$/i.test(clean);
}

function resolveRelative(cwd: string, relative: string): string {
  const parts = cwd.split("/").filter(Boolean);
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function fileKind(path: string): "pdf" | "image" | "text" | "unknown" {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(?:png|jpe?g|gif|webp|heic|bmp|svg)$/i.test(path)) return "image";
  if (EMBEDDED_EXTENSIONS.test(path)) return "text";
  return "unknown";
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
