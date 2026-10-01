// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";

class Socket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  static all: Socket[] = [];
  constructor(readonly url: string, readonly protocols: string[]) { Socket.all.push(this); }
}

beforeEach(() => { Socket.all = []; vi.stubGlobal("WebSocket", Socket); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("session disposal", () => {
  it("clears timers owned by the old session", () => {
    vi.useFakeTimers();
    const session = new Session(new RpcClient({ url: "wss://a.ts.net/ws", token: "a-token" }));
    session.toast("thread", "Finished");
    expect(vi.getTimerCount()).toBe(1);
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    session.toast("thread", "Late update");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects pending requests and ignores old socket events without interrupting turns", async () => {
    const rpc = new RpcClient({ url: "wss://a.ts.net/ws", token: "a-token" });
    const session = new Session(rpc);
    session.start();
    const socket = Socket.all[0];
    socket.onopen!();
    const late = socket.onmessage!;
    const result = rpc.request("thread/read", { threadId: "same" }).catch((err) => err);
    session.dispose();
    expect(await result).toMatchObject({ message: expect.stringContaining("connection stopped") });
    late({ data: JSON.stringify({ method: "pocket/upstream/status", params: { connected: true } }) });
    expect(session.store.get().upstreamConnected).toBe(false);
    expect(socket.onmessage).toBeNull();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.send.mock.calls.map(([data]) => JSON.parse(data).method)).not.toContain("turn/interrupt");
    session.dispose();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("stops reconnecting after the host revokes the pairing", () => {
    vi.useFakeTimers();
    const rpc = new RpcClient({ url: "wss://a.ts.net/ws", token: "a-token" });
    rpc.start();
    Socket.all[0].onopen!();
    Socket.all[0].onclose!({ code: 4001 });
    expect(rpc.pairingRevoked).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(Socket.all).toHaveLength(1);
    rpc.stop();
  });
});
