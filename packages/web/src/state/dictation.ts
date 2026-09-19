import type { JsonRpcNotification } from "@codex-pocket/protocol";
import type { RpcClient } from "../rpc/client.js";
import workletUrl from "../audio/pcm-worklet.ts?worker&url";
import { applyTranscript, transcriptText, type TranscriptState } from "./transcript.js";

// Speech-to-text through the host: the microphone is captured here as raw
// PCM and streamed over the JSON-RPC socket (`pocket/dictation/*`); the host
// relays it to the same dictation backend the Codex desktop app uses and
// streams transcripts back per utterance.

const START = "pocket/dictation/start";
const AUDIO = "pocket/dictation/audio";
const STOP = "pocket/dictation/stop";
const TRANSCRIPT = "pocket/dictation/transcript";
const ENDED = "pocket/dictation/ended";

export function dictationSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function" && typeof AudioContext !== "undefined" && "audioWorklet" in AudioContext.prototype;
}

export interface Dictation {
  stop(): void;
}

export interface DictationHandlers {
  /** Whole transcript so far, revised as the backend refines it. */
  onText: (text: string) => void;
  /** Fires once, when the session has fully stopped. */
  onEnd: (error?: string) => void;
}

/**
 * Opens the microphone and a host dictation session. Must be called from a
 * user gesture (iOS only lets an AudioContext start inside one).
 */
export function startDictation(rpc: RpcClient, handlers: DictationHandlers): Dictation {
  const ctx = new AudioContext();
  let transcript: TranscriptState = new Map();
  let sessionId: string | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let unsubscribe: (() => void) | null = null;
  let stopping = false;
  let ended = false;
  const pendingAudio: string[] = [];

  const finish = (error?: string) => {
    if (ended) return;
    ended = true;
    unsubscribe?.();
    node?.port.postMessage("stop");
    node?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    handlers.onEnd(error);
  };

  const onNotification = (n: JsonRpcNotification) => {
    const p = (n.params ?? {}) as { sessionId?: string; utteranceId?: string; text?: string; final?: boolean; error?: string };
    if (p.sessionId !== sessionId) return;
    if (n.method === TRANSCRIPT && typeof p.utteranceId === "string" && typeof p.text === "string") {
      transcript = applyTranscript(transcript, { utteranceId: p.utteranceId, text: p.text, final: p.final === true });
      handlers.onText(transcriptText(transcript));
    } else if (n.method === ENDED) {
      finish(p.error);
    }
  };

  const run = async () => {
    unsubscribe = rpc.onNotification(onNotification);
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (stopping) return finish();
    await ctx.audioWorklet.addModule(workletUrl);
    await ctx.resume();
    node = new AudioWorkletNode(ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data === "stopped") {
        // The worklet has flushed its last chunk, so the stop can go out behind it.
        if (sessionId && !ended) rpc.request(STOP, { sessionId }).then(() => finish(), (err: unknown) => finish(describeError(err)));
        return;
      }
      if (!(e.data instanceof ArrayBuffer)) return;
      const chunk = base64(new Uint8Array(e.data));
      if (sessionId) rpc.notify(AUDIO, { sessionId, audio: chunk });
      else pendingAudio.push(chunk);
    };
    ctx.createMediaStreamSource(stream).connect(node);
    // Safari only runs a worklet that leads somewhere; a silent gain keeps the graph alive.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);

    const { sessionId: id } = await rpc.request<{ sessionId: string }>(START, { sampleRateHz: ctx.sampleRate });
    if (stopping) {
      await rpc.request(STOP, { sessionId: id }).catch(() => {});
      return finish();
    }
    sessionId = id;
    for (const chunk of pendingAudio.splice(0)) rpc.notify(AUDIO, { sessionId, audio: chunk });
  };

  run().catch((err: unknown) => finish(describeError(err)));

  return {
    stop() {
      if (stopping || ended) return;
      stopping = true;
      if (!sessionId) return; // `run` notices the flag at its next step
      // Drain the worklet first; its "stopped" ack sends the stop request, and the
      // host then delivers the final transcript before `ended` tears everything down.
      stream?.getTracks().forEach((t) => t.stop());
      node?.port.postMessage("stop");
    },
  };
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) return "Microphone access was denied";
  if (err instanceof DOMException && err.name === "NotFoundError") return "No microphone found";
  return err instanceof Error ? err.message : String(err);
}
