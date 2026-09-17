import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CloudflareDns } from "../src/dns/cloudflare.js";
import { acmeChallengeHandlers, wildcardFor } from "../src/tls/acme.js";
import { certificateExpiry, needsRenewal, TlsManager } from "../src/tls/manager.js";
import { parseTlsSettings } from "../src/config/settings.js";
import { launchAgentPlist } from "../src/launchd.js";

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "expiring.crt"), "utf8");
const DAY = 86_400_000;

describe("parseTlsSettings", () => {
  it("accepts a complete block and defaults staging to false", () => {
    expect(parseTlsSettings({ zone: "example.com", hostname: "mac.lan.example.com", email: "me@example.com", cloudflareToken: "tok" })).toEqual({
      zone: "example.com",
      hostname: "mac.lan.example.com",
      email: "me@example.com",
      cloudflareToken: "tok",
      staging: false,
    });
  });

  it("rejects a hostname outside the zone and missing fields", () => {
    expect(() => parseTlsSettings({ zone: "example.com", hostname: "mac.other.net", email: "e", cloudflareToken: "t" })).toThrow(/zone/);
    expect(() => parseTlsSettings({ zone: "example.com" })).toThrow(/hostname/);
  });
});

describe("wildcardFor", () => {
  it("covers the hostname's parent label", () => {
    expect(wildcardFor("mac.lan.example.com")).toBe("*.lan.example.com");
  });
});

// Records every request; answers from a script keyed by "METHOD path".
function fakeCloudflare(script: Record<string, unknown>) {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ method, url: path, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
    const key = Object.keys(script).find((k) => path.startsWith(k.split(" ")[1]) && k.startsWith(method));
    if (!key) return new Response(JSON.stringify({ success: false, errors: [{ message: `no script for ${method} ${path}` }] }), { status: 404 });
    return new Response(JSON.stringify({ success: true, result: script[key] }), { status: 200 });
  };
  return { calls, dns: new CloudflareDns("tok", fetchFn as unknown as typeof fetch) };
}

describe("CloudflareDns", () => {
  it("creates a record when none exists", async () => {
    const { calls, dns } = fakeCloudflare({
      "GET /client/v4/zones?name=example.com": [{ id: "z1" }],
      "GET /client/v4/zones/z1/dns_records?": [],
      "POST /client/v4/zones/z1/dns_records": { id: "r1" },
    });
    await dns.upsertRecord("example.com", "mac.lan.example.com", "A", "192.168.1.5");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /client/v4/zones?name=example.com",
      "GET /client/v4/zones/z1/dns_records?type=A&name=mac.lan.example.com",
      "POST /client/v4/zones/z1/dns_records",
    ]);
    expect(calls[2].body).toEqual({ type: "A", name: "mac.lan.example.com", content: "192.168.1.5", ttl: 60, proxied: false });
    expect(calls[0].auth).toBe("Bearer tok");
  });

  it("updates an existing record instead of duplicating it and caches the zone id", async () => {
    const { calls, dns } = fakeCloudflare({
      "GET /client/v4/zones?name=example.com": [{ id: "z1" }],
      "GET /client/v4/zones/z1/dns_records?": [{ id: "r9", content: "10.0.0.1" }],
      "PUT /client/v4/zones/z1/dns_records/r9": { id: "r9" },
    });
    await dns.upsertRecord("example.com", "mac.lan.example.com", "A", "192.168.1.5");
    await dns.upsertRecord("example.com", "mac.lan.example.com", "A", "192.168.1.6");
    const methods = calls.map((c) => `${c.method} ${c.url}`);
    expect(methods.filter((m) => m.startsWith("GET /client/v4/zones?"))).toHaveLength(1);
    expect(methods.filter((m) => m.startsWith("PUT"))).toHaveLength(2);
  });

  it("skips the write when the record already has the value", async () => {
    const { calls, dns } = fakeCloudflare({
      "GET /client/v4/zones?name=example.com": [{ id: "z1" }],
      "GET /client/v4/zones/z1/dns_records?": [{ id: "r9", content: "192.168.1.5" }],
    });
    expect(await dns.upsertRecord("example.com", "mac.lan.example.com", "A", "192.168.1.5")).toBe(false);
    expect(calls.some((c) => c.method === "PUT" || c.method === "POST")).toBe(false);
  });

  it("deletes matching TXT records", async () => {
    const { calls, dns } = fakeCloudflare({
      "GET /client/v4/zones?name=example.com": [{ id: "z1" }],
      "GET /client/v4/zones/z1/dns_records?": [{ id: "r1", content: "abc" }, { id: "r2", content: "other" }],
      "DELETE /client/v4/zones/z1/dns_records/r1": { id: "r1" },
    });
    await dns.deleteRecord("example.com", "_acme-challenge.lan.example.com", "TXT", "abc");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/client/v4/zones/z1/dns_records/r1"]);
  });

  it("surfaces API errors", async () => {
    const { dns } = fakeCloudflare({});
    await expect(dns.upsertRecord("example.com", "x.example.com", "A", "1.2.3.4")).rejects.toThrow(/no script/);
  });
});

describe("acmeChallengeHandlers", () => {
  it("writes and removes the _acme-challenge TXT record for the identifier", async () => {
    const log: string[] = [];
    const dns = {
      upsertRecord: async (zone: string, name: string, type: string, content: string) => (log.push(`up ${zone} ${name} ${type} ${content}`), true),
      deleteRecord: async (zone: string, name: string, type: string, content?: string) => (log.push(`del ${zone} ${name} ${type} ${content}`), true),
    };
    const { challengeCreateFn, challengeRemoveFn } = acmeChallengeHandlers(dns, "example.com");
    const authz = { identifier: { type: "dns", value: "lan.example.com" }, wildcard: true } as never;
    const challenge = { type: "dns-01" } as never;
    await challengeCreateFn(authz, challenge, "keyauth");
    await challengeRemoveFn(authz, challenge, "keyauth");
    expect(log).toEqual(["up example.com _acme-challenge.lan.example.com TXT keyauth", "del example.com _acme-challenge.lan.example.com TXT keyauth"]);
  });

  it("refuses non-dns challenges", async () => {
    const { challengeCreateFn } = acmeChallengeHandlers({ upsertRecord: async () => true, deleteRecord: async () => true }, "example.com");
    await expect(challengeCreateFn({ identifier: { type: "dns", value: "x" } } as never, { type: "http-01" } as never, "k")).rejects.toThrow(/dns-01/);
  });
});

describe("certificate expiry", () => {
  const expiry = certificateExpiry(FIXTURE);

  it("reads notAfter", () => {
    expect(expiry.toISOString().startsWith("2026-12-16")).toBe(true);
  });

  it("renews inside the 30 day window and when already expired", () => {
    expect(needsRenewal(FIXTURE, expiry.getTime() - 60 * DAY)).toBe(false);
    expect(needsRenewal(FIXTURE, expiry.getTime() - 10 * DAY)).toBe(true);
    expect(needsRenewal(FIXTURE, expiry.getTime() + DAY)).toBe(true);
  });
});

describe("TlsManager", () => {
  const settings = { zone: "example.com", hostname: "mac.lan.example.com", email: "e@example.com", cloudflareToken: "t", staging: false };

  function harness(opts: { cert?: string; ip?: string | null; now?: number } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "cp-tls-"));
    if (opts.cert) {
      const { writeFileSync } = require("node:fs") as typeof import("node:fs");
      writeFileSync(join(dir, "fullchain.pem"), opts.cert);
      writeFileSync(join(dir, "privkey.pem"), "KEY");
    }
    const records: string[] = [];
    let ip = opts.ip === undefined ? "192.168.1.5" : opts.ip;
    let issued = 0;
    const manager = new TlsManager({
      settings,
      certsDir: dir,
      dns: { upsertRecord: async (_z, name, type, content) => (records.push(`${type} ${name} ${content}`), true), deleteRecord: async () => true },
      issue: async () => (issued++, { key: "NEWKEY", cert: FIXTURE }),
      lanIp: () => ip,
      now: () => opts.now ?? certificateExpiry(FIXTURE).getTime() - 60 * DAY,
      log: () => {},
    });
    return { dir, records, manager, setIp: (v: string | null) => (ip = v), issuedCount: () => issued };
  }

  it("issues a certificate when none exists and points the A record at the LAN IP", async () => {
    const h = harness();
    const material = await h.manager.ensure();
    expect(material).toEqual({ key: "NEWKEY", cert: FIXTURE });
    expect(h.records).toEqual(["A mac.lan.example.com 192.168.1.5"]);
    expect(readFileSync(join(h.dir, "fullchain.pem"), "utf8")).toBe(FIXTURE);
    expect(readFileSync(join(h.dir, "privkey.pem"), "utf8")).toBe("NEWKEY");
  });

  it("keeps a certificate that is still fresh", async () => {
    const h = harness({ cert: FIXTURE });
    const material = await h.manager.ensure();
    expect(h.issuedCount()).toBe(0);
    expect(material?.key).toBe("KEY");
  });

  it("renews inside the window and notifies listeners", async () => {
    const h = harness({ cert: FIXTURE, now: certificateExpiry(FIXTURE).getTime() - 5 * DAY });
    const seen: string[] = [];
    h.manager.onCertificate((m) => seen.push(m.key));
    await h.manager.ensure();
    expect(h.issuedCount()).toBe(1);
    expect(seen).toEqual(["NEWKEY"]);
  });

  it("updates DNS only when the LAN IP changes", async () => {
    const h = harness({ cert: FIXTURE });
    await h.manager.ensure();
    await h.manager.syncDns();
    expect(h.records).toEqual(["A mac.lan.example.com 192.168.1.5"]);
    h.setIp("192.168.1.9");
    await h.manager.syncDns();
    expect(h.records).toEqual(["A mac.lan.example.com 192.168.1.5", "A mac.lan.example.com 192.168.1.9"]);
    h.setIp(null);
    await h.manager.syncDns();
    expect(h.records).toHaveLength(2);
  });

  it("returns null and keeps going when issuance fails but no cert exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cp-tls-"));
    const manager = new TlsManager({
      settings,
      certsDir: dir,
      dns: { upsertRecord: async () => true, deleteRecord: async () => true },
      issue: async () => {
        throw new Error("acme down");
      },
      lanIp: () => "192.168.1.5",
      now: () => Date.now(),
      log: () => {},
    });
    await expect(manager.ensure()).resolves.toBeNull();
    expect(existsSync(join(dir, "fullchain.pem"))).toBe(false);
  });
});

describe("launchAgentPlist", () => {
  it("renders a KeepAlive agent that runs the built CLI", () => {
    const xml = launchAgentPlist({ label: "com.codex-pocket.host", node: "/usr/local/bin/node", script: "/repo/packages/host/dist/cli.js", logFile: "/home/.codex-pocket/host.log", home: "/home" });
    expect(xml).toContain("<string>com.codex-pocket.host</string>");
    expect(xml).toContain("<string>/usr/local/bin/node</string>");
    expect(xml).toContain("<string>/repo/packages/host/dist/cli.js</string>");
    expect(xml).toContain("<string>serve</string>");
    expect(xml).toContain("<key>KeepAlive</key>");
    expect(xml).toContain("<string>/home/.codex-pocket/host.log</string>");
    expect(xml).toContain("<key>HOME</key>");
  });
});
