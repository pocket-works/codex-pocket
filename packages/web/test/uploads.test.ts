import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFile } from "../src/state/uploads.js";
import type { HostClient } from "../src/state/host-client.js";

beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe("CSV uploads", () => {
  it.each(["text/csv", "application/vnd.ms-excel", "", "application/octet-stream"])("normalizes CSV MIME type %j and uploads the original bytes", async (type) => {
    const file = new File(["name,total\r\nAlice,42\r\n"], "SALES.CSV", { type });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: "/uploads/abc.csv" })));
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    expect(await uploadFile(file, { fetch } as unknown as HostClient)).toBe("/uploads/abc.csv");
    expect(fetch).toHaveBeenCalledWith("/api/uploads", expect.objectContaining({
      method: "POST", body: file, headers: expect.objectContaining({ "Content-Type": "text/csv" }),
    }));
    expect(decode).not.toHaveBeenCalled();
  });

  it("reports the upload limit", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 413 }));
    await expect(uploadFile(new File(["a"], "a.csv"), { fetch } as unknown as HostClient)).rejects.toThrow("maximum 10 MB");
  });

  it("rejects unsupported files before uploading", async () => {
    const fetch = vi.fn();
    await expect(uploadFile(new File(["a"], "a.pdf", { type: "application/pdf" }), { fetch } as unknown as HostClient)).rejects.toThrow("Choose an image or CSV file");
    expect(fetch).not.toHaveBeenCalled();
  });
});
