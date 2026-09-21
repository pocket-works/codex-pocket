import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

// A link in an answer opens outside: inside a Home Screen app it would
// otherwise navigate the app itself away to that page.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Model output is untrusted HTML as far as the browser is concerned.
export function renderMarkdown(text: string): string {
  return withCopyButtons(DOMPurify.sanitize(marked.parse(text, { async: false }) as string));
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
