import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminClient } from "../src/admin.js";

describe("AdminClient", () => {
  let server: Server;
  let home: string;
  let seen: Array<{ method: string; url: string; auth: string }>;

  beforeEach(async () => {
    seen = [];
    server = createServer((req, res) => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization ?? "" });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/admin/status") res.end(JSON.stringify({ publicUrl: "http://x", codexConnected: false, deviceCount: 0 }));
      else if (req.url === "/api/admin/devices") res.end(JSON.stringify({ devices: [{ id: "d1", name: "Pixel", createdAt: 1, lastSeenAt: 2, push: false }] }));
      else res.writeHead(404).end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    home = mkdtempSync(join(tmpdir(), "cp-desk-"));
    writeFileSync(join(home, "runtime.json"), JSON.stringify({ pid: 1, port, tls: false, publicUrl: "http://x" }));
    writeFileSync(join(home, "admin.token"), "secret\n");
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  it("reads runtime.json and sends the admin token", async () => {
    const admin = new AdminClient(home);
    expect(await admin.status()).toEqual({ publicUrl: "http://x", codexConnected: false, deviceCount: 0 });
    expect(seen[0]).toEqual({ method: "GET", url: "/api/admin/status", auth: "Bearer secret" });
    expect(await admin.devices()).toEqual([{ id: "d1", name: "Pixel", createdAt: 1, lastSeenAt: 2, push: false }]);
  });

  it("status is null when nothing is listening yet", async () => {
    const empty = mkdtempSync(join(tmpdir(), "cp-desk-empty-"));
    expect(await new AdminClient(empty).status()).toBeNull();
  });

  it("other calls surface errors", async () => {
    await expect(new AdminClient(home).revoke("nope")).rejects.toThrow("HTTP 404");
  });
});
