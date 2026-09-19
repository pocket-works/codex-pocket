// Speech-to-text through the browser's own recogniser (Siri dictation on
// iOS Safari). No server involved; hidden where the API is missing.

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  const w = window as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationSupported(): boolean {
  return typeof window !== "undefined" && ctor() !== null && window.isSecureContext;
}

export interface Dictation {
  stop(): void;
}

/**
 * Starts listening; `onText` receives the whole transcript so far (final
 * parts followed by the interim guess) on every update, `onEnd` fires once
 * when recognition stops for any reason.
 */
export function startDictation(handlers: { onText: (text: string) => void; onEnd: (error?: string) => void }): Dictation {
  const Ctor = ctor();
  if (!Ctor) throw new Error("Speech recognition is not available in this browser");
  const rec = new Ctor();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let error: string | undefined;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    handlers.onText(finalText + interim);
  };
  rec.onerror = (e) => {
    // "no-speech"/"aborted" are how a quiet stop looks; everything else is worth showing.
    if (e.error !== "no-speech" && e.error !== "aborted") error = e.error;
  };
  rec.onend = () => handlers.onEnd(error);
  rec.start();
  return { stop: () => rec.stop() };
}
