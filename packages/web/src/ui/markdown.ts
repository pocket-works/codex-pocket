import DOMPurify from "dompurify";
import { marked } from "marked";
import { classifyLink, localImagePath, pdfCitation, type LinkAction } from "./file-citation.js";

marked.setOptions({ gfm: true, breaks: true });
marked.use({ extensions: [pdfCitation] });

// Model output is untrusted HTML as far as the browser is concerned.
export function renderMarkdown(text: string, cwd?: string): string {
  const safeHtml = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  return withCopyButtons(markLocalImages(routeMarkdownLinks(safeHtml, cwd), cwd));
}

function routeMarkdownLinks(html: string, cwd?: string): string {
  if (typeof document === "undefined" || typeof window === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>("a")) {
    const href = anchor.getAttribute("href");
    if (!href) {
      anchor.setAttribute("data-pocket-link", "unsafe");
      anchor.setAttribute("aria-disabled", "true");
      continue;
    }
    applyLinkAction(anchor, classifyLink(href, window.location.href, cwd));
  }
  return template.innerHTML;
}

function applyLinkAction(node: HTMLAnchorElement, action: LinkAction): void {
  if (action.kind === "unsafe") {
    node.removeAttribute("href");
    node.removeAttribute("target");
    node.removeAttribute("rel");
    node.setAttribute("data-pocket-link", "unsafe");
    node.setAttribute("title", "This link cannot be opened safely.");
    return;
  }
  if (action.kind === "internal" || action.kind === "fragment" || action.kind === "file") {
    node.setAttribute("data-pocket-link", action.kind);
    if (action.kind === "file") node.setAttribute("data-pocket-path", action.path);
    node.removeAttribute("target");
    node.removeAttribute("rel");
    return;
  }
  if (action.kind === "unsupported") {
    node.setAttribute("data-pocket-link", "unsupported");
    node.removeAttribute("href");
    node.removeAttribute("target");
    node.removeAttribute("rel");
    node.setAttribute("title", "This link uses an unsupported protocol.");
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
}

function markLocalImages(html: string, cwd?: string): string {
  if (typeof document === "undefined" || typeof window === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll<HTMLImageElement>("img[src]")) {
    const path = localImagePath(image.getAttribute("src") ?? "", window.location.href, cwd);
    if (!path) continue;
    image.setAttribute("data-local-image-path", path);
    image.removeAttribute("src");
  }
  return template.innerHTML;
}

// Selecting text inside a code block on a phone is a chore, so each one
// gets a copy button. Added after sanitising: the markup is ours, and
// marked always emits fenced code as a bare <pre><code>.
const COPY_BUTTON = '<button type="button" class="code-copy" aria-label="Copy code">Copy</button>';

function withCopyButtons(html: string): string {
  return html.replace(/<pre>/g, `<div class="code-block">${COPY_BUTTON}<pre>`).replace(/<\/pre>/g, "</pre></div>");
}

/** Click handler for a rendered-markdown container: copies the block a copy button belongs to. */
export async function handleCodeCopy(e: { target: EventTarget | null }): Promise<void> {
  const button = (e.target as Element | null)?.closest?.(".code-copy");
  const pre = button?.parentElement?.querySelector("pre");
  if (!button || !pre) return;
  try {
    await navigator.clipboard.writeText(pre.textContent ?? "");
    button.textContent = "Copied";
    button.classList.add("done");
    setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("done");
    }, 1200);
  } catch {
    // Clipboard needs a secure context; nothing else to do.
  }
}
