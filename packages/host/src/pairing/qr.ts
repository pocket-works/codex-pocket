import QRCode from "qrcode";

export async function renderQrTerminal(text: string): Promise<string> {
  return QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "M" });
}

export function pairingUrl(baseUrl: string, code: string): string {
  // The code rides in the fragment so it never reaches server logs.
  return `${baseUrl}/#pair=${encodeURIComponent(code)}`;
}
