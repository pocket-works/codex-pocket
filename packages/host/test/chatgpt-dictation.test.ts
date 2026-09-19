import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { DICTATION_SUBPROTOCOL, DictationSession, type TranscriptEvent } from "../src/dictation/chatgpt-dictation.js";

const AUTH = { accessToken: "tok-123", accountId: "acct-9" };

interface FakeDictationBackend {
  url: string;
  /** The next accepted upstream socket together with the upgrade request. */
  nextConnection(): Promise<{ ws: WebSocket; req: IncomingMessage; messages: unknown[]; nextMessage(): Promise<unknown> }>;
  close(): Promise<void>;
}

// Stand-in for wss://chatgpt.com/backend-api/dictation/stream.
async function startBackend(opts: { subprotocol?: string | false } = {}): Promise<FakeDictationBackend> {
  const server: Server = createServer();
  const wss = new WebSocketServer({
    server,
    handleProtocols: () => (opts.subprotocol === undefined ? DICTATION_SUBPROTOCOL : opts.subprotocol),
  });
  const waiting: Array<(c: { ws: WebSocket; req: IncomingMessage }) => void> = [];
  const accepted: Array<{ ws: WebSocket; req: IncomingMessage }> = [];
  wss.on("connection", (ws, req) => {
    const w = waiting.shift();
    if (w) w({ ws, req });
    else accepted.push({ ws, req });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/backend-api/dictation/stream`,
    async nextConnection() {
      const conn = accepted.shift() ?? (await new Promise<{ ws: WebSocket; req: IncomingMessage }>((resolve) => waiting.push(resolve)));
      const messages: unknown[] = [];
      const pending: Array<(m: unknown) => void> = [];
      conn.ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as unknown;
        const p = pending.shift();
        if (p) p(msg);
        else messages.push(msg);
      });
      return {
        ...conn,
        messages,
        nextMessage() {
          const ready = messages.shift();
          if (ready !== undefined) return Promise.resolve(ready);
          return new Promise((resolve) => pending.push(resolve));
        },
      };
    },
    close() {
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve) => wss.close(() => server.close(() => resolve())));
    },
  };
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

describe("DictationSession", () => {
  let backend: FakeDictationBackend | null = null;
  afterEach(async () => {
    await backend?.close();
    backend = null;
  });

  async function openSession(events: TranscriptEvent[], sampleRateHz = 16000) {
    const opening = DictationSession.open({ auth: AUTH, sampleRateHz, url: backend!.url, onEvent: (e) => events.push(e) });
    const up = await backend!.nextConnection();
    const start = (await up.nextMessage()) as { type: string; config: Record<string, unknown> };
    send(up.ws, { type: "session.started", sequence_no: 1, session: { session_id: "dict_1", status: "active", config: start.config } });
    return { session: await opening, up, start };
  }

  it("authenticates with the Codex login and negotiates the dictation subprotocol", async () => {
    backend = await startBackend();
    const { up, start } = await openSession([], 48000);
    expect(up.req.headers.authorization).toBe("Bearer tok-123");
    expect(up.req.headers["chatgpt-account-id"]).toBe("acct-9");
    expect(up.req.headers.originator).toBe("Codex Desktop");
    expect(up.req.headers["sec-websocket-protocol"]).toBe(DICTATION_SUBPROTOCOL);
    expect(start.type).toBe("session.start");
    expect(start.config).toMatchObject({ input_audio_format: "pcm16", sample_rate_hz: 48000, num_channels: 1, transcript_delivery_mode: "segment" });
  });

  it("forwards audio and surfaces cumulative segments and finals per utterance", async () => {
    backend = await startBackend();
    const events: TranscriptEvent[] = [];
    const { session, up } = await openSession(events);
    session.appendAudio("AAAA");
    expect(await up.nextMessage()).toEqual({ type: "audio.append", audio: "AAAA" });

    send(up.ws, { type: "speech.started", utterance_id: "u1" });
    send(up.ws, { type: "session.updated", session: {} });
    send(up.ws, { type: "transcript.segment", utterance_id: "u1", revision: 1, text: "帮我" });
    send(up.ws, { type: "transcript.delta", utterance_id: "u1", delta: "把" });
    send(up.ws, { type: "transcript.segment", utterance_id: "u1", revision: 3, text: "帮我把 Composer" });
    send(up.ws, { type: "transcript.segment", utterance_id: "u1", revision: 2, text: "帮我把" }); // stale, dropped
    send(up.ws, { type: "transcript.final", utterance_id: "u1", revision: 4, text: "帮我把 Composer。" });
    await waitFor(() => events.length === 3);
    expect(events).toEqual([
      { type: "transcript", utteranceId: "u1", text: "帮我", final: false },
      { type: "transcript", utteranceId: "u1", text: "帮我把 Composer", final: false },
      { type: "transcript", utteranceId: "u1", text: "帮我把 Composer。", final: true },
    ]);
  });

  it("stop flushes, waits for the pending final, then closes cleanly", async () => {
    backend = await startBackend();
    const events: TranscriptEvent[] = [];
    const { session, up } = await openSession(events);
    send(up.ws, { type: "transcript.segment", utterance_id: "u1", revision: 1, text: "hello" });
    await waitFor(() => events.length === 1);

    const stopped = session.stop();
    expect(await up.nextMessage()).toEqual({ type: "audio.flush" });
    // No session.close until the utterance is final.
    await new Promise((r) => setTimeout(r, 50));
    expect(up.messages).toEqual([]);
    send(up.ws, { type: "transcript.final", utterance_id: "u1", revision: 2, text: "hello world" });
    expect(await up.nextMessage()).toEqual({ type: "session.close" });
    send(up.ws, { type: "session.updated", session: { status: "closed" } });
    up.ws.close(1000);
    await stopped;
    expect(events).toEqual([
      { type: "transcript", utteranceId: "u1", text: "hello", final: false },
      { type: "transcript", utteranceId: "u1", text: "hello world", final: true },
      { type: "ended" },
    ]);
    // Audio after stop is dropped rather than sent to a closing stream.
    session.appendAudio("BBBB");
    expect(up.messages).toEqual([]);
  });

  it("reports a backend error and ends the session once", async () => {
    backend = await startBackend();
    const events: TranscriptEvent[] = [];
    const { up } = await openSession(events);
    send(up.ws, { type: "session.error", error: { code: "quota", message: "too much" } });
    await waitFor(() => events.length === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([{ type: "ended", error: "too much" }]);
  });

  it("reports an unexpected upstream close as an error", async () => {
    backend = await startBackend();
    const events: TranscriptEvent[] = [];
    const { up } = await openSession(events);
    up.ws.close(1011, "boom");
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ type: "ended", error: expect.stringContaining("1011") });
  });

  it("rejects when the backend does not select the subprotocol", async () => {
    backend = await startBackend({ subprotocol: false });
    await expect(DictationSession.open({ auth: AUTH, sampleRateHz: 16000, url: backend.url, onEvent: () => {} })).rejects.toThrow(/subprotocol/);
  });

  it("explains an HTTP 401 as an expired Codex login", async () => {
    const server = createServer();
    server.on("upgrade", (_req, socket) => {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(DictationSession.open({ auth: AUTH, sampleRateHz: 16000, url: `ws://127.0.0.1:${port}/x`, onEvent: () => {} })).rejects.toThrow(/401.*sign in/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}
