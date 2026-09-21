import QRCode from "qrcode";

// The pairing window is a single self-contained page: no preload, no IPC,
// the QR image travels inline as a data URL.

export interface PairPageInput {
  url: string;
  code: string;
  qrDataUrl: string;
  validMinutes: number;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderPairPage(input: PairPageInput): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pair a phone</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px -apple-system, system-ui, sans-serif; text-align: center; -webkit-user-select: none; }
  img { width: 240px; height: 240px; image-rendering: pixelated; background: #fff; border-radius: 8px; padding: 8px; box-sizing: border-box; }
  .code { font: 600 22px ui-monospace, monospace; letter-spacing: 2px; margin: 12px 0 4px; -webkit-user-select: text; }
  .url { font-size: 12px; opacity: .7; word-break: break-all; -webkit-user-select: text; }
  .hint { font-size: 12px; opacity: .7; margin-top: 12px; }
</style></head>
<body>
  <img alt="Pairing QR code" src="${input.qrDataUrl}">
  <div class="hint">Scan with the phone's camera, or open the app and type this code:</div>
  <div class="code">${esc(formatCode(input.code))}</div>
  <div class="url">${esc(input.url)}</div>
  <div class="hint">Valid for ${input.validMinutes} minutes.</div>
</body></html>`;
}

export async function pairPageFor(pairing: { url: string; code: string }, validMinutes = 10): Promise<string> {
  const qrDataUrl = await QRCode.toDataURL(pairing.url, { errorCorrectionLevel: "M", margin: 0, scale: 6 });
  return renderPairPage({ ...pairing, qrDataUrl, validMinutes });
}
