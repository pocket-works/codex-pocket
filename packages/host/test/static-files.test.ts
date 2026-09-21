import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serveStatic } from "../src/server/static-files.js";

describe("serveStatic", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    const root = mkdtempSync(join(tmpdir(), "cp-static-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html>");
    writeFileSync(join(root, "assets", "app-abc123.js"), "1");
    writeFileSync(join(root, "icon-180.png"), "png");
    writeFileSync(join(root, "sw.js"), "sw");
    server = createServer((req, res) => {
      if (!serveStatic(root, req, res)) res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  const cacheControl = async (path: string) => (await fetch(`${base}${path}`)).headers.get("cache-control");

  it("lets hashed bundles be cached forever", async () => {
    expect(await cacheControl("/assets/app-abc123.js")).toBe("public, max-age=31536000, immutable");
  });

  it("revalidates everything with a fixed name", async () => {
    expect(await cacheControl("/")).toBe("no-cache");
    expect(await cacheControl("/icon-180.png")).toBe("no-cache");
    expect(await cacheControl("/sw.js")).toBe("no-cache");
  });
});
