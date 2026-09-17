import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import acme from "acme-client";
import type { DnsProvider } from "../dns/cloudflare.js";
import type { TlsSettings } from "../config/settings.js";

export interface CertificateMaterial {
  key: string;
  cert: string;
}

/** `mac.lan.example.com` -> `*.lan.example.com`: one cert covers any host name under the LAN label. */
export function wildcardFor(hostname: string): string {
  return `*.${hostname.split(".").slice(1).join(".")}`;
}

// dns-01: prove control of the name by publishing the key authorization as
// a TXT record. The identifier for a wildcard is the bare parent name.
export function acmeChallengeHandlers(dns: DnsProvider, zone: string) {
  const name = (authz: acme.Authorization) => `_acme-challenge.${authz.identifier.value}`;
  return {
    async challengeCreateFn(authz: acme.Authorization, challenge: { type: string }, keyAuthorization: string): Promise<void> {
      if (challenge.type !== "dns-01") throw new Error(`only dns-01 challenges are supported, got ${challenge.type}`);
      await dns.upsertRecord(zone, name(authz), "TXT", keyAuthorization);
    },
    async challengeRemoveFn(authz: acme.Authorization, _challenge: { type: string }, keyAuthorization: string): Promise<void> {
      await dns.deleteRecord(zone, name(authz), "TXT", keyAuthorization);
    },
  };
}

// The ACME account key is reused across renewals so Let's Encrypt sees one
// account; it lives next to the certificates.
async function accountKey(certsDir: string): Promise<Buffer> {
  const file = join(certsDir, "account.key");
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(certsDir, { recursive: true, mode: 0o700 });
  const key = await acme.crypto.createPrivateKey();
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export interface IssueOptions {
  settings: TlsSettings;
  dns: DnsProvider;
  certsDir: string;
  log?: (msg: string) => void;
}

/** Orders a wildcard certificate for the hostname's parent label via Let's Encrypt. */
export async function issueCertificate(opts: IssueOptions): Promise<CertificateMaterial> {
  const log = opts.log ?? (() => {});
  const wildcard = wildcardFor(opts.settings.hostname);
  const client = new acme.Client({
    directoryUrl: opts.settings.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey: await accountKey(opts.certsDir),
  });
  const [key, csr] = await acme.crypto.createCsr({ commonName: wildcard, altNames: [wildcard] });
  log(`requesting certificate for ${wildcard} (${opts.settings.staging ? "staging" : "production"})`);
  const cert = await client.auto({
    csr,
    email: opts.settings.email,
    termsOfServiceAgreed: true,
    challengePriority: ["dns-01"],
    ...acmeChallengeHandlers(opts.dns, opts.settings.zone),
  });
  return { key: key.toString(), cert };
}
