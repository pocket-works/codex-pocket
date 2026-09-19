// AudioWorklet processor: turns the microphone's float samples into 16-bit
// little-endian PCM and posts them to the main thread in ~100 ms chunks.
// Runs inside the AudioWorklet global scope, so it must not import anything.

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const CHUNK_MS = 100;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private buffer = new Int16Array(Math.round((sampleRate * CHUNK_MS) / 1000));
  private length = 0;
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "stop") {
        this.stopped = true;
        this.flush();
        this.port.postMessage("stopped");
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.length++] = s < 0 ? s * 32768 : s * 32767;
      if (this.length === this.buffer.length) this.flush();
    }
    return true;
  }

  private flush(): void {
    if (this.length === 0) return;
    const out = this.buffer.slice(0, this.length);
    this.port.postMessage(out.buffer, [out.buffer]);
    this.length = 0;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
