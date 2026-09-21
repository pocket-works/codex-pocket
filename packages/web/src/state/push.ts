import { getToken, isStandalone } from "./auth.js";

export type PushStatus = "unsupported" | "needs-install" | "denied" | "off" | "on";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getToken() ?? ""}` };
}

function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iOS only exposes push to apps added to the home screen.
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const sub = await (await registration()).pushManager.getSubscription();
  return sub ? "on" : "off";
}

export async function enablePush(): Promise<PushStatus> {
  if ((await Notification.requestPermission()) !== "granted") return "denied";
  const res = await fetch("/api/push/vapid", { headers: authHeaders() });
  if (!res.ok) throw new Error(`push is not available on the host (HTTP ${res.status})`);
  const { publicKey } = (await res.json()) as { publicKey: string };
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const put = await fetch("/api/push/subscription", { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
  if (!put.ok) throw new Error(`could not save the subscription (HTTP ${put.status})`);
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const sub = await (await registration()).pushManager.getSubscription();
  await fetch("/api/push/subscription", { method: "DELETE", headers: authHeaders() }).catch(() => {});
  await sub?.unsubscribe();
  return "off";
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
