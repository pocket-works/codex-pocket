import type { JsonRpcMessage, JsonRpcNotification } from "@codex-pocket/protocol";
import type { DeviceStore, PushSubscription } from "../auth/device-store.js";
import { pushEventFor } from "./events.js";

/** What a phone tells us over the WebSocket about what it is looking at. */
export interface ClientState {
  threadId: string | null;
  visible: boolean;
}

export interface PushNotifierOptions {
  store: DeviceStore;
  /** Delivers one payload; throws with `statusCode` 404/410 when the subscription is dead. */
  send: (subscription: PushSubscription, payload: string) => Promise<void>;
  /** Thread title for the notification heading; null falls back to a generic one. */
  threadTitle: (threadId: string) => Promise<string | null>;
  log?: (msg: string) => void;
}

/** How many ephemeral ids to remember before dropping the oldest. */
const EPHEMERAL_MEMORY = 500;

// Turns upstream events into Web Push notifications for paired phones that
// are not already looking at the thread in question.
export class PushNotifier {
  private readonly clients = new Map<string, { deviceId: string; state: ClientState }>();
  /**
   * Threads app-server marks ephemeral (the phone's own title generation, for
   * one). They are never written to disk, so a notification pointing at one
   * could not be opened: `thread/resume` answers "no rollout found". Keep them
   * in memory and stay quiet about them.
   */
  private readonly ephemeralThreads = new Set<string>();
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: PushNotifierOptions) {
    this.log = opts.log ?? (() => {});
  }

  setClientState(connId: string, deviceId: string, state: ClientState): void {
    this.clients.set(connId, { deviceId, state });
  }

  clearClient(connId: string): void {
    this.clients.delete(connId);
  }

  /** Feed every upstream notification/request through here. */
  async handle(msg: JsonRpcMessage): Promise<void> {
    if ("method" in msg && !("id" in msg)) this.trackEphemeral(msg as JsonRpcNotification);
    const event = pushEventFor(msg);
    if (!event) return;
    if (this.ephemeralThreads.has(event.threadId)) return;
    const subs = await this.opts.store.listPushSubscriptions();
    if (subs.length === 0) return;
    const title = (await this.opts.threadTitle(event.threadId).catch(() => null)) ?? "Codex";
    const payload = JSON.stringify({ title, body: event.body, threadId: event.threadId, tag: event.threadId });
    await Promise.all(
      subs.filter((s) => !this.isWatching(s.deviceId, event.threadId)).map((s) => this.deliver(s.deviceId, s.subscription, payload)),
    );
  }

  /** Remembers which live threads app-server says are throwaway. */
  private trackEphemeral(msg: JsonRpcNotification): void {
    const p = (msg.params ?? {}) as Record<string, unknown>;
    if (msg.method === "thread/started") {
      // The only place the flag reaches us; turn notifications carry no `ephemeral`.
      const thread = p.thread as { id?: unknown; ephemeral?: unknown } | undefined;
      if (typeof thread?.id !== "string") return;
      if (thread.ephemeral !== true) return;
      this.ephemeralThreads.add(thread.id);
      // Ephemeral threads are rarely closed, so keep the set itself bounded.
      if (this.ephemeralThreads.size > EPHEMERAL_MEMORY) {
        const oldest = this.ephemeralThreads.values().next().value;
        if (oldest !== undefined) this.ephemeralThreads.delete(oldest);
      }
    } else if (msg.method === "thread/closed") {
      if (typeof p.threadId === "string") this.ephemeralThreads.delete(p.threadId);
    }
  }

  private isWatching(deviceId: string, threadId: string): boolean {
    for (const c of this.clients.values()) if (c.deviceId === deviceId && c.state.visible && c.state.threadId === threadId) return true;
    return false;
  }

  private async deliver(deviceId: string, subscription: PushSubscription, payload: string): Promise<void> {
    try {
      await this.opts.send(subscription, payload);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        this.log(`push subscription for ${deviceId} is gone; removing`);
        await this.opts.store.setPushSubscription(deviceId, null);
      } else this.log(`push to ${deviceId} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
