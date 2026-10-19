import type { TokenizerAndRendererExtension } from "marked";
import runtimeStyles from "./visualization.css?raw";

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

/** Untrusted scripts run only in an opaque-origin iframe with no host bridge. */
export function visualizationDocument(fragment: string): string {
  if (new TextEncoder().encode(fragment).length > MAX_VISUALIZATION_SIZE) throw new Error("This visualization is too large to preview (maximum 1 MB).");
  const policy = `default-src 'none'; script-src 'unsafe-inline' ${CDNS}; style-src 'unsafe-inline' ${CDNS} ${FONTS}; img-src data: blob: ${CDNS}; font-src ${CDNS} ${FONTS}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${runtimeStyles}</style><script>
window.openai = {
  widgetState: null,
  setWidgetState: async function(state) { this.widgetState = state; },
  sendFollowUpMessage: async function() { throw new Error('Follow-up actions are not supported in Pocket previews. Send a message in the conversation.'); }
};
document.addEventListener('click', function(event) {
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
