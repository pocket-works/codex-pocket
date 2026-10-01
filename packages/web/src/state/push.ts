import { isStandalone } from "./auth.js";
import { HostClient, HostHttpError } from "./host-client.js";

export type PushStatus = "unsupported" | "needs-install" | "denied" | "off" | "on";

function availability(): PushStatus | null {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone() ? "needs-install" : "unsupported";
  }
  return Notification.permission === "denied" ? "denied" : null;
}

export function pushScope(id: string): string { return `/push/${encodeURIComponent(id)}/`; }

async function registration(host: HostClient): Promise<ServiceWorkerRegistration | null> {
  const scope = new URL(pushScope(host.id), location.origin).href;
  const reg = await navigator.serviceWorker.getRegistration(scope);
  return reg?.scope === scope ? reg : null;
}

async function legacyRegistration(host: HostClient): Promise<ServiceWorkerRegistration | null> {
  if (host.origin !== location.origin) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg?.scope === `${location.origin}/` ? reg : null;
}

export async function pushStatus(host: HostClient): Promise<PushStatus> {
  const unavailable = availability();
  if (unavailable) return unavailable;
  const reg = await registration(host);
  const sub = await reg?.pushManager.getSubscription() ?? await (await legacyRegistration(host))?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

async function activeRegistration(host: HostClient): Promise<ServiceWorkerRegistration> {
  const existing = await registration(host);
  const reg = existing ?? await navigator.serviceWorker.register(
    `/push-worker.js?computer=${encodeURIComponent(host.id)}&name=${encodeURIComponent(host.computer.name)}`,
    { scope: pushScope(host.id) },
  );
  if (!reg.active) {
    await new Promise<void>((resolve, reject) => {
      const install = reg.installing ?? reg.waiting;
      if (!install) return reject(new Error("Notification worker did not install."));
      const timer = setTimeout(() => { install.removeEventListener("statechange", changed); reject(new Error("Notification setup timed out.")); }, 15_000);
      const changed = () => {
        if (install.state === "activated" || install.state === "redundant") {
          clearTimeout(timer);
          install.removeEventListener("statechange", changed);
          install.state === "activated" ? resolve() : reject(new Error("Notification worker could not activate."));
        }
      };
      install.addEventListener("statechange", changed);
      changed();
    });
  }
  return reg;
}

export async function enablePush(host: HostClient, requestPermission = true): Promise<PushStatus> {
  const unavailable = availability();
  if (unavailable) return unavailable;
  const permission = requestPermission ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const res = await host.fetch("/api/push/vapid");
  if (!res.ok) throw new HostHttpError(res.status);
  const { publicKey } = await res.json() as { publicKey: string };
  const reg = await activeRegistration(host);
  let sub = await reg.pushManager.getSubscription();
  const key = urlBase64ToUint8Array(publicKey);
  const oldKey = sub?.options.applicationServerKey;
  if (sub && (!oldKey || Array.from(new Uint8Array(oldKey)).join() !== Array.from(key).join())) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const put = await host.fetch("/api/push/subscription", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!put.ok) throw new HostHttpError(put.status);
  const legacy = await legacyRegistration(host);
  await (await legacy?.pushManager.getSubscription())?.unsubscribe();
  return "on";
}

export async function disablePush(host: HostClient): Promise<PushStatus> {
  const res = await host.fetch("/api/push/subscription", { method: "DELETE" });
  if (!res.ok && res.status !== 401) throw new HostHttpError(res.status);
  await forgetPush(host);
  return "off";
}

export async function forgetPush(host: HostClient): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await registration(host);
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await reg?.unregister();
  await (await (await legacyRegistration(host))?.pushManager.getSubscription())?.unsubscribe();
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
