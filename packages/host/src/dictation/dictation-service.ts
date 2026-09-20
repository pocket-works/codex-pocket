import { randomBytes } from "node:crypto";
import type { JsonRpcMessage, JsonRpcRequest } from "@codex-pocket/protocol";
import { readCodexAuth, type CodexAuth } from "../codex/auth.js";
import { DictationSession, type DictationSessionOptions } from "./chatgpt-dictation.js";

// Phone-facing dictation methods. They ride the same JSON-RPC WebSocket as
// the Codex traffic but are handled by the host and never forwarded
// upstream, like `pocket/client/state`.
//
//   request  pocket/dictation/start  { sampleRateHz }           -> { sessionId }
//   notify   pocket/dictation/audio  { sessionId, audio }        (base64 pcm16 mono)
//   request  pocket/dictation/stop   { sessionId }               -> {}
//   notify   pocket/dictation/transcript { sessionId, utteranceId, text, final }
//   notify   pocket/dictation/ended  { sessionId, error? }
export const DICTATION_START = "pocket/dictation/start";
export const DICTATION_AUDIO = "pocket/dictation/audio";
export const DICTATION_STOP = "pocket/dictation/stop";
export const DICTATION_TRANSCRIPT = "pocket/dictation/transcript";
export const DICTATION_ENDED = "pocket/dictation/ended";

const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 96000;

export interface DictationServiceOptions {
  /** Where the ChatGPT login comes from; re-read on every session start. */
  readAuth?: () => CodexAuth | null;
  /** Opens the upstream stream; swapped out in tests. */
  open?: (opts: DictationSessionOptions) => Promise<DictationSession>;
  /** HTTP proxy for the upstream stream; see the `outboundProxy` setting. */
  proxy?: string;
  log?: (msg: string) => void;
}

export interface DictationHandle {
  /** Returns true when the message was a dictation message and has been dealt with. */
  handle(msg: JsonRpcMessage): boolean;
  detach(): void;
}

export class DictationService {
  private readonly readAuth: () => CodexAuth | null;
  private readonly open: (opts: DictationSessionOptions) => Promise<DictationSession>;
  private readonly log: (msg: string) => void;
  private readonly proxy: string | undefined;

  constructor(opts: DictationServiceOptions = {}) {
    this.readAuth = opts.readAuth ?? (() => readCodexAuth());
    this.open = opts.open ?? ((o) => DictationSession.open(o));
    this.log = opts.log ?? (() => {});
    this.proxy = opts.proxy;
  }

  /** Whether Codex is signed in with ChatGPT, which is all dictation needs. */
  get available(): boolean {
    return this.readAuth() !== null;
  }

  /** One handle per phone connection; at most one live session each. */
  attach(send: (msg: JsonRpcMessage) => void): DictationHandle {
    let current: { id: string; session: DictationSession } | null = null;
    let opening = false;

    const reply = (req: JsonRpcRequest, result: unknown) => send({ jsonrpc: "2.0", id: req.id, result });
    const fail = (req: JsonRpcRequest, message: string) => send({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } });

    const start = async (req: JsonRpcRequest) => {
      if (current || opening) return fail(req, "dictation is already running on this connection");
      const params = (req.params ?? {}) as { sampleRateHz?: unknown };
      const sampleRateHz = typeof params.sampleRateHz === "number" ? Math.round(params.sampleRateHz) : NaN;
      if (!(sampleRateHz >= MIN_SAMPLE_RATE && sampleRateHz <= MAX_SAMPLE_RATE)) return fail(req, "sampleRateHz must be between 8000 and 96000");
      const auth = this.readAuth();
      if (!auth) return fail(req, "dictation needs Codex to be signed in with ChatGPT");
      const id = randomBytes(8).toString("hex");
      opening = true;
      try {
        const session = await this.open({
          auth,
          sampleRateHz,
          proxy: this.proxy,
          log: this.log,
          onEvent: (ev) => {
            if (ev.type === "transcript") {
              send({ jsonrpc: "2.0", method: DICTATION_TRANSCRIPT, params: { sessionId: id, utteranceId: ev.utteranceId, text: ev.text, final: ev.final } });
              return;
            }
            if (current?.id === id) current = null;
            if (ev.error) this.log(`dictation ended with error: ${ev.error}`);
            send({ jsonrpc: "2.0", method: DICTATION_ENDED, params: ev.error ? { sessionId: id, error: ev.error } : { sessionId: id } });
          },
        });
        current = { id, session };
        reply(req, { sessionId: id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`dictation failed to start: ${message}`);
        fail(req, message);
      } finally {
        opening = false;
      }
    };

    const stop = async (req: JsonRpcRequest) => {
      const params = (req.params ?? {}) as { sessionId?: unknown };
      if (!current || current.id !== params.sessionId) return fail(req, "no such dictation session");
      const { session } = current;
      await session.stop();
      current = null;
      reply(req, {});
    };

    return {
      handle: (msg) => {
        if (!("method" in msg)) return false;
        if (msg.method === DICTATION_AUDIO) {
          const params = (msg.params ?? {}) as { sessionId?: unknown; audio?: unknown };
          if (current && current.id === params.sessionId && typeof params.audio === "string") current.session.appendAudio(params.audio);
          return true;
        }
        if (msg.method === DICTATION_START) {
          if ("id" in msg) void start(msg as JsonRpcRequest);
          return true;
        }
        if (msg.method === DICTATION_STOP) {
          if ("id" in msg) void stop(msg as JsonRpcRequest);
          return true;
        }
        return false;
      },
      detach: () => {
        current?.session.abort();
        current = null;
      },
    };
  }
}
