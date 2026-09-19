import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import webpush from "web-push";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

// One VAPID key pair per host, created on first use. Changing it would
// invalidate every phone's subscription, so it is persisted next to the
// device store.
export function loadOrCreateVapidKeys(file: string): VapidKeys {
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as VapidKeys;
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
  return keys;
}
