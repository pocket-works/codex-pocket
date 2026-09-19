import { describe, expect, it } from "vitest";
import type { JsonRpcMessage } from "@codex-pocket/protocol";
import type { DictationSession, DictationSessionOptions, TranscriptEvent } from "../src/dictation/chatgpt-dictation.js";
import { DICTATION_AUDIO, DICTATION_ENDED, DICTATION_START, DICTATION_STOP, DICTATION_TRANSCRIPT, DictationService } from "../src/dictation/dictation-service.js";

const AUTH = { accessToken: "tok", accountId: null };

// Scripted stand-in for the upstream session: records what the service
// sends and lets the test emit transcript events.
class FakeSession {
  audio: string[] = [];
  stopped = false;
  aborted = false;
  constructor(readonly opts: DictationSessionOptions) {}
  appendAudio(a: string) {
    this.audio.push(a);
  }
  async stop() {
    this.stopped = true;
    this.opts.onEvent({ type: "ended" });
  }
  abort() {
    this.aborted = true;
  }
  emit(ev: TranscriptEvent) {
    this.opts.onEvent(ev);
  }
}

function setup(opts: { auth?: typeof AUTH | null; openError?: string } = {}) {
  const sessions: FakeSession[] = [];
  const out: JsonRpcMessage[] = [];
  const service = new DictationService({
    readAuth: () => (opts.auth === undefined ? AUTH : opts.auth),
    open: async (o) => {
      if (opts.openError) throw new Error(opts.openError);
      const s = new FakeSession(o);
      sessions.push(s);
      return s as unknown as DictationSession;
    },
  });
  const handle = service.attach((m) => out.push(m));
  const request = (id: number, method: string, params: unknown) => handle.handle({ jsonrpc: "2.0", id, method, params });
  const notify = (method: string, params: unknown) => handle.handle({ jsonrpc: "2.0", method, params });
  const response = (id: number) => waitFor(() => out.find((m) => "id" in m && m.id === id));
  return { service, handle, sessions, out, request, notify, response };
}

describe("DictationService", () => {
  it("is available exactly when Codex has a ChatGPT login", () => {
    expect(setup().service.available).toBe(true);
    expect(setup({ auth: null }).service.available).toBe(false);
  });

  it("ignores messages that are not dictation", () => {
    const { handle } = setup();
    expect(handle.handle({ jsonrpc: "2.0", id: 1, method: "thread/list", params: {} })).toBe(false);
  });

  it("runs start → audio → transcript → stop over one connection", async () => {
    const { sessions, out, request, notify, response } = setup();
    expect(request(1, DICTATION_START, { sampleRateHz: 48000 })).toBe(true);
    const started = (await response(1)) as { result: { sessionId: string } };
    const { sessionId } = started.result;
    expect(sessionId).toMatch(/^[0-9a-f]{16}$/);
    expect(sessions[0].opts).toMatchObject({ auth: AUTH, sampleRateHz: 48000 });

    notify(DICTATION_AUDIO, { sessionId, audio: "AAAA" });
    notify(DICTATION_AUDIO, { sessionId: "other", audio: "BBBB" });
    expect(sessions[0].audio).toEqual(["AAAA"]);

    sessions[0].emit({ type: "transcript", utteranceId: "u1", text: "hi", final: false });
    expect(out.at(-1)).toEqual({ jsonrpc: "2.0", method: DICTATION_TRANSCRIPT, params: { sessionId, utteranceId: "u1", text: "hi", final: false } });

    request(2, DICTATION_STOP, { sessionId });
    await response(2);
    expect(sessions[0].stopped).toBe(true);
    expect(out.filter((m) => "method" in m && m.method === DICTATION_ENDED)).toEqual([{ jsonrpc: "2.0", method: DICTATION_ENDED, params: { sessionId } }]);

    // A second session is allowed once the first has ended.
    request(3, DICTATION_START, { sampleRateHz: 16000 });
    expect(await response(3)).toMatchObject({ id: 3, result: {} });
    expect(sessions).toHaveLength(2);
  });

  it("refuses a second concurrent session and unknown stop ids", async () => {
    const { request, response } = setup();
    request(1, DICTATION_START, { sampleRateHz: 16000 });
    await response(1);
    request(2, DICTATION_START, { sampleRateHz: 16000 });
    expect(await response(2)).toMatchObject({ error: { message: expect.stringContaining("already running") } });
    request(3, DICTATION_STOP, { sessionId: "nope" });
    expect(await response(3)).toMatchObject({ error: { message: expect.stringContaining("no such") } });
  });

  it("fails clearly without a ChatGPT login, on bad params, and on upstream errors", async () => {
    const noAuth = setup({ auth: null });
    noAuth.request(1, DICTATION_START, { sampleRateHz: 16000 });
    expect(await noAuth.response(1)).toMatchObject({ error: { message: expect.stringContaining("signed in") } });

    const badRate = setup();
    badRate.request(1, DICTATION_START, { sampleRateHz: 1 });
    expect(await badRate.response(1)).toMatchObject({ error: { message: expect.stringContaining("sampleRateHz") } });

    const upstream = setup({ openError: "HTTP 401" });
    upstream.request(1, DICTATION_START, { sampleRateHz: 16000 });
    expect(await upstream.response(1)).toMatchObject({ error: { message: "HTTP 401" } });
    // The failed attempt does not block the next one.
    upstream.request(2, DICTATION_START, { sampleRateHz: 16000 });
    expect(await upstream.response(2)).toMatchObject({ error: { message: "HTTP 401" } });
  });

  it("relays an upstream error as `ended` and frees the slot", async () => {
    const { sessions, out, request, response } = setup();
    request(1, DICTATION_START, { sampleRateHz: 16000 });
    const { result } = (await response(1)) as { result: { sessionId: string } };
    sessions[0].emit({ type: "ended", error: "quota" });
    expect(out.at(-1)).toEqual({ jsonrpc: "2.0", method: DICTATION_ENDED, params: { sessionId: result.sessionId, error: "quota" } });
    request(2, DICTATION_START, { sampleRateHz: 16000 });
    expect(await response(2)).toMatchObject({ result: {} });
  });

  it("aborts the live session when the phone disconnects", async () => {
    const { handle, sessions, request, response } = setup();
    request(1, DICTATION_START, { sampleRateHz: 16000 });
    await response(1);
    handle.detach();
    expect(sessions[0].aborted).toBe(true);
  });
});

async function waitFor<T>(get: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}
