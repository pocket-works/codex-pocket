import type { TokenizerAndRendererExtension } from "marked";
import runtimeStyles from "./visualization.css?raw";
import { classifyLink } from "./file-citation.js";
import { VISUALIZATION_IMAGE_ORIGIN, visualizationImageBase, visualizationImagePath } from "./visualization-images.js";
import { installVisualizationImages } from "./visualization-image-runtime.js";

const MARKER = /^visualize(\{[^\n]*?\})/;
const CDNS = "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";
const FONTS = "https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net";
export const MAX_VISUALIZATION_SIZE = 1024 * 1024;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A Marked extension keeps references inside fenced and inline code literal.
export const visualizationReference: TokenizerAndRendererExtension = {
  name: "visualizationReference",
  level: "inline",
  start: (src) => src.indexOf("visualize"),
  tokenizer(src) {
    const match = MARKER.exec(src);
    if (!match) return;
    try {
      const data = JSON.parse(match[1]) as { path?: unknown; title?: unknown };
      if (typeof data.path !== "string" || !data.path.startsWith("/") || !/\.html?$/i.test(data.path) || /[\u0000-\u001f]/.test(data.path)) return;
      return { type: "visualizationReference", raw: match[0], path: data.path, title: typeof data.title === "string" ? data.title : "View visualization" };
    } catch { return; }
  },
  renderer(token) {
    return `<button type="button" class="visualization-card" data-visualization-path="${escapeAttribute(token.path as string)}"><span aria-hidden="true">▥</span> ${escapeAttribute(token.title as string)}</button>`;
  },
};

/** Leave local images for the sandbox bridge so page rendering never waits for image reads. */
export function prepareVisualization(html: string, path: string): string {
  checkSize(html);
  const document = new DOMParser().parseFromString(html, "text/html");
  const cwd = path.slice(0, path.lastIndexOf("/")) || "/";
  for (const image of document.querySelectorAll<HTMLImageElement>("img[src]")) {
    const src = image.getAttribute("src")!;
    const action = classifyLink(src, "https://pocket.invalid/", cwd);
    if (action.kind !== "file") continue;
    image.removeAttribute("srcset");
    if (visualizationImagePath(action.path, path)) {
      image.setAttribute("src", visualizationImageBase(action.path));
      image.setAttribute("loading", "lazy");
    } else {
      image.removeAttribute("src");
      image.alt ||= src;
    }
  }
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const action = classifyLink(anchor.getAttribute("href")!, "https://pocket.invalid/", cwd);
    if (action.kind !== "file") continue;
    if (visualizationImagePath(action.path, path)) anchor.setAttribute("href", visualizationImageBase(action.path));
    else anchor.removeAttribute("href");
  }
  return visualizationDocument(document.documentElement.outerHTML, visualizationImageBase(path));
}

function checkSize(html: string): void {
  if (new TextEncoder().encode(html).length > MAX_VISUALIZATION_SIZE) throw new Error("This visualization is too large to preview (maximum 1 MB).");
}

/** Scripts have an opaque origin; only directory-scoped image requests reach the parent. */
function visualizationDocument(fragment: string, baseUrl: string): string {
  const policy = `default-src 'none'; script-src 'unsafe-inline' ${CDNS}; style-src 'unsafe-inline' ${CDNS} ${FONTS}; img-src data: blob: ${CDNS}; font-src ${CDNS} ${FONTS}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri ${VISUALIZATION_IMAGE_ORIGIN}; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${escapeAttribute(baseUrl)}"><style>${runtimeStyles}</style><script>(${installVisualizationImages.toString()})(${JSON.stringify(baseUrl).replace(/</g, "\\u003c")});</script><script>
window.openai = {
  widgetState: null,
  setWidgetState: async function(state) { this.widgetState = state; },
  sendFollowUpMessage: async function() { throw new Error('Follow-up actions are not supported in Pocket previews. Send a message in the conversation.'); }
};
document.addEventListener('click', function(event) {
  var imageLink = event.target.closest('[data-preview-image]');
  if (imageLink) {
    event.preventDefault();
    var viewer = document.createElement('dialog');
    viewer.className = 'pocket-image-dialog';
    var close = document.createElement('button');
    close.textContent = 'Close image';
    close.onclick = function() { viewer.close(); };
    var image = document.createElement('img');
    image.src = imageLink.querySelector('img').src;
    image.alt = imageLink.textContent || 'Image';
    viewer.append(close, image);
    document.body.append(viewer);
    viewer.addEventListener('close', function() { viewer.remove(); });
    viewer.showModal();
    return;
  }
  var tab = event.target.closest('[role="tab"]');
  if (!tab || tab.disabled || tab.getAttribute('aria-disabled') === 'true') return;
  var group = tab.closest('[role="tablist"]');
  if (!group) return;
  group.querySelectorAll('[role="tab"]').forEach(function(item) {
    var active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
    var panel = document.getElementById(item.getAttribute('aria-controls'));
    if (panel) panel.hidden = panel.id !== tab.getAttribute('aria-controls');
  });
});
document.addEventListener('DOMContentLoaded', function() {
  if (window.lucide) window.lucide.createIcons({ attrs: { width: 16, height: 16 } });
  document.querySelectorAll('[data-tooltip]').forEach(function(item) { item.title = item.getAttribute('data-tooltip'); });
});
</script><script src="https://cdn.jsdelivr.net/npm/lucide@0.468.0/dist/umd/lucide.min.js" referrerpolicy="no-referrer"></script></head><body>${fragment}</body></html>`;
}
