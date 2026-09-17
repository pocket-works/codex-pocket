import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DnsProvider } from "../dns/cloudflare.js";
import type { TlsSettings } from "../config/settings.js";
import type { CertificateMaterial } from "./acme.js";

const DAY_MS = 86_400_000;
const RENEW_BEFORE_DAYS = 30;
const IP_CHECK_MS = 60_000;
const CERT_CHECK_MS = 12 * 60 * 60 * 1000;

export function certificateExpiry(certPem: string): Date {
  return new Date(new X509Certificate(certPem).validTo);
}

export function needsRenewal(certPem: string, now: number, beforeDays = RENEW_BEFORE_DAYS): boolean {
  return certificateExpiry(certPem).getTime() - now < beforeDays * DAY_MS;
}

export interface TlsManagerOptions {
  settings: TlsSettings;
  certsDir: string;
  dns: DnsProvider;
  issue: () => Promise<CertificateMaterial>;
  lanIp: () => string | null;
  now?: () => number;
  log?: (msg: string) => void;
}

// Keeps two things true while `serve` runs: the A record points at this
// Mac's current LAN IP, and the certificate on disk has >30 days left.
export class TlsManager {
  private readonly listeners = new Set<(m: CertificateMaterial) => void>();
  private lastIp: string | null = null;
  private timers: NodeJS.Timeout[] = [];
  private readonly log: (msg: string) => void;
  private readonly now: () => number;

  constructor(private readonly opts: TlsManagerOptions) {
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? (() => Date.now());
  }

  private get certFile(): string {
    return join(this.opts.certsDir, "fullchain.pem");
  }

  private get keyFile(): string {
    return join(this.opts.certsDir, "privkey.pem");
  }

  current(): CertificateMaterial | null {
    if (!existsSync(this.certFile) || !existsSync(this.keyFile)) return null;
    return { cert: readFileSync(this.certFile, "utf8"), key: readFileSync(this.keyFile, "utf8") };
  }

  onCertificate(listener: (m: CertificateMaterial) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Point the hostname at the current LAN IP if it moved. */
  async syncDns(): Promise<void> {
    const ip = this.opts.lanIp();
    if (!ip || ip === this.lastIp) return;
    try {
      const changed = await this.opts.dns.upsertRecord(this.opts.settings.zone, this.opts.settings.hostname, "A", ip);
      this.lastIp = ip;
      if (changed) this.log(`DNS: ${this.opts.settings.hostname} -> ${ip}`);
    } catch (err) {
      this.log(`DNS update failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Issue or renew as needed. Returns what should be served now (null: nothing usable). */
  async ensure(): Promise<CertificateMaterial | null> {
    await this.syncDns();
    const existing = this.current();
    if (existing && !needsRenewal(existing.cert, this.now())) return existing;
    try {
      const fresh = await this.opts.issue();
      mkdirSync(this.opts.certsDir, { recursive: true, mode: 0o700 });
      writeFileSync(this.keyFile, fresh.key, { mode: 0o600 });
      writeFileSync(this.certFile, fresh.cert, { mode: 0o600 });
      this.log(`certificate ${existing ? "renewed" : "issued"}, valid until ${certificateExpiry(fresh.cert).toISOString().slice(0, 10)}`);
      for (const l of this.listeners) l(fresh);
      return fresh;
    } catch (err) {
      this.log(`certificate ${existing ? "renewal" : "issuance"} failed: ${err instanceof Error ? err.message : err}`);
      return existing;
    }
  }

  start(): void {
    this.timers.push(setInterval(() => void this.syncDns(), IP_CHECK_MS));
    this.timers.push(setInterval(() => void this.ensure(), CERT_CHECK_MS));
    for (const t of this.timers) t.unref();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
