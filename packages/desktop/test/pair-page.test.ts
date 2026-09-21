import { describe, expect, it } from "vitest";
import { formatCode, pairPageFor, renderPairPage } from "../src/pair-page.js";

describe("pair page", () => {
  it("formats the code like the CLI does", () => {
    expect(formatCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("embeds the QR image, code and URL, escaping HTML", () => {
    const html = renderPairPage({ url: "http://x/#pair=A<B", code: "ABCDEFGH", qrDataUrl: "data:image/png;base64,AAAA", validMinutes: 10 });
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("ABCD-EFGH");
    expect(html).toContain("http://x/#pair=A&lt;B");
    expect(html).toContain("Valid for 10 minutes");
  });

  it("renders a real QR code for the pairing URL", async () => {
    const html = await pairPageFor({ url: "http://10.0.0.2:7333/#pair=ABCDEFGH", code: "ABCDEFGH" });
    expect(html).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
  });
});
