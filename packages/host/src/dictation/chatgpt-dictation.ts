import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { CodexAuth } from "../codex/auth.js";

// One streaming dictation session against the ChatGPT backend the Codex
// desktop app uses for its own dictation button. This is not a public API:
// the wire format below was taken from the desktop app's bundle and may
// change without notice, so everything here is defensive and the caller
// keeps a fallback.
//
// Client → server: `session.start` (config), `audio.append` (base64 pcm16),
// `audio.flush`, `session.close`.
// Server → client: `session.started`, `speech.started/stopped`,
// `transcript.segment` (cumulative text for one utterance, revised as more
// audio arrives), `transcript.final`, `transcript.failed`, `session.error`,
// plus a chatty `session.updated` we ignore.

export const DICTATION_STREAM_URL = "wss://chatgpt.com/backend-api/dictation/stream";
export const DICTATION_SUBPROTOCOL = "chatgpt-dictation";
const DEFAULT_USER_AGENT = "Codex Desktop/26.429.30905 (darwin; arm64)";
const START_TIMEOUT_MS = 10_000;
const FINAL_TIMEOUT_MS = 4_000;
const CLOSE_TIMEOUT_MS = 2_000;

export type TranscriptEvent =
  | { type: "transcript"; utteranceId: string; text: string; final: boolean }
  | { type: "ended"; error?: string };

export interface DictationSessionOptions {
  auth: CodexAuth;
  sampleRateHz: number;
  onEvent: (event: TranscriptEvent) => void;
  url?: string;
  userAgent?: string;
  log?: (msg: string) => void;
}

interface UpstreamEvent {
  type?: string;
  utterance_id?: string;
  revision?: number;
  text?: string;
  message?: string;
  error?: { message?: string } | string;
}

export class DictationSession {
  /** Resolves once the backend has acknowledged `session.start`. */
  static open(opts: DictationSessionOptions): Promise<DictationSession> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${opts.auth.accessToken}`,
        originator: "Codex Desktop",
        "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
      };
      if (opts.auth.accountId) headers["ChatGPT-Account-Id"] = opts.auth.accountId;
      const ws = new WebSocket(opts.url ?? DICTATION_STREAM_URL, [DICTATION_SUBPROTOCOL], { headers, perMessageDeflate: false });
      const session = new DictationSession(ws, opts);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => settle(() => {
        ws.terminate();
        reject(new Error("dictation backend did not answer session.start in time"));
      }), START_TIMEOUT_MS);
      ws.on("unexpected-response", (_req, res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        settle(() => reject(new Error(describeHttpStatus(status))));
      });
      ws.on("error", (err) => settle(() => reject(err)));
      ws.on("close", (code) => settle(() => reject(new Error(`dictation stream closed before session.start completed (code ${code})`))));
      ws.on("open", () => {
        if (ws.protocol !== DICTATION_SUBPROTOCOL) {
          settle(() => {
            ws.terminate();
            reject(new Error(`dictation backend did not negotiate the ${DICTATION_SUBPROTOCOL} subprotocol`));
          });
          return;
        }
        session.sendStart();
      });
      session.onStarted = () => settle(() => resolve(session));
    });
  }

  private onStarted: (() => void) | null = null;
  private started = false;
  private ended = false;
  private closing = false;
  /** Utterances that have produced text but no `transcript.final` yet. */
  private readonly openUtterances = new Map<string, number>();
  private allFinal: (() => void) | null = null;

  private constructor(
    private readonly ws: WebSocket,
    private readonly opts: DictationSessionOptions,
  ) {
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("close", (code, reason) => this.finish(this.closing || code === 1000 ? undefined : `dictation stream closed (${code}${reason.length ? ` ${reason.toString()}` : ""})`));
    ws.on("error", (err) => this.finish(err.message));
  }

  /** Base64 little-endian 16-bit mono PCM at the session's sample rate. */
  appendAudio(audioBase64: string): void {
    if (this.ended || this.closing) return;
    this.send({ type: "audio.append", audio: audioBase64 });
  }

  /**
   * Flushes buffered audio, waits for the remaining utterances to finalise,
   * then closes. Resolves when the stream is fully closed.
   */
  async stop(): Promise<void> {
    if (this.ended) return;
    if (this.closing) return this.waitForEnd();
    this.closing = true;
    this.send({ type: "audio.flush" });
    await this.waitForFinals();
    this.send({ type: "session.close" });
    const closeTimer = setTimeout(() => this.ws.terminate(), CLOSE_TIMEOUT_MS);
    try {
      await this.waitForEnd();
    } finally {
      clearTimeout(closeTimer);
    }
  }

  /** Drops the session without waiting for pending transcripts. */
  abort(): void {
    if (this.ended) return;
    this.closing = true;
    this.ws.terminate();
    this.finish();
  }

  private sendStart(): void {
    this.send({
      type: "session.start",
      dictation_session_id: randomUUID(),
      attempt_id: randomUUID(),
      config: {
        input_audio_format: "pcm16",
        sample_rate_hz: this.opts.sampleRateHz,
        num_channels: 1,
        max_buffer_size_bytes: 4 * 1024 * 1024,
        max_utterance_duration_ms: 30_000,
        session_ttl_ms: 300_000,
        provider_mode: "streaming_sse",
        transcript_delivery_mode: "segment",
        vad: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
      },
    });
  }

  private send(msg: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private handleMessage(text: string): void {
    let ev: UpstreamEvent;
    try {
      ev = JSON.parse(text) as UpstreamEvent;
    } catch {
      return;
    }
    switch (ev.type) {
      case "session.started":
        if (!this.started) {
          this.started = true;
          this.onStarted?.();
        }
        return;
      case "transcript.segment":
      case "transcript.final": {
        if (typeof ev.utterance_id !== "string" || typeof ev.text !== "string") return;
        const final = ev.type === "transcript.final";
        const revision = typeof ev.revision === "number" ? ev.revision : 0;
        // Segments are cumulative hypotheses for one utterance; ignore stale revisions.
        const last = this.openUtterances.get(ev.utterance_id) ?? -1;
        if (!final && revision < last) return;
        if (final) this.openUtterances.delete(ev.utterance_id);
        else this.openUtterances.set(ev.utterance_id, revision);
        this.opts.onEvent({ type: "transcript", utteranceId: ev.utterance_id, text: ev.text, final });
        this.checkAllFinal();
        return;
      }
      case "transcript.failed":
        if (typeof ev.utterance_id === "string") {
          this.openUtterances.delete(ev.utterance_id);
          this.opts.log?.(`dictation: utterance ${ev.utterance_id} failed`);
          this.checkAllFinal();
        }
        return;
      case "session.error": {
        const message = typeof ev.error === "string" ? ev.error : ev.error?.message ?? ev.message ?? "dictation backend reported an error";
        this.closing = true;
        this.ws.close(1000);
        this.finish(message);
        return;
      }
      default:
        return;
    }
  }

  private waitForFinals(): Promise<void> {
    if (this.openUtterances.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.allFinal = null;
        resolve();
      }, FINAL_TIMEOUT_MS);
      this.allFinal = () => {
        clearTimeout(timer);
        this.allFinal = null;
        resolve();
      };
    });
  }

  private checkAllFinal(): void {
    if (this.openUtterances.size === 0) this.allFinal?.();
  }

  private waitForEnd(): Promise<void> {
    if (this.ended) return Promise.resolve();
    return new Promise((resolve) => this.ws.once("close", () => resolve()));
  }

  private finish(error?: string): void {
    if (this.ended) return;
    this.ended = true;
    this.allFinal?.();
    // `open()` still pending: its own close handler rejects, no event needed.
    if (!this.started) return;
    this.opts.onEvent(error ? { type: "ended", error } : { type: "ended" });
  }
}

function describeHttpStatus(status: number): string {
  if (status === 401 || status === 403) return `dictation backend rejected the Codex login (HTTP ${status}); sign in to Codex again`;
  if (status === 429) return "dictation backend is rate limiting this account (HTTP 429)";
  return `dictation backend refused the connection (HTTP ${status})`;
}
