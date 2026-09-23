import type { TokenizerAndRendererExtension } from "marked";

const CITATION = /^:codex-file-citation\{path="([^"\n]+\.pdf)"(?:\s+purpose="[^"\n]*")?\}/i;

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
