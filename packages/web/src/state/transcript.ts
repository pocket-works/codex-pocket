// Dictation transcript bookkeeping, kept free of browser APIs so it can be unit-tested.

export interface TranscriptUpdate {
  utteranceId: string;
  text: string;
  final: boolean;
}

// Utterances arrive in order; each one's text is a cumulative hypothesis that
// gets revised until its final version lands.
export type TranscriptState = Map<string, { text: string; final: boolean }>;

export function applyTranscript(state: TranscriptState, u: TranscriptUpdate): TranscriptState {
  const current = state.get(u.utteranceId);
  if (current?.final && !u.final) return state; // late revision of a finished utterance
  const next = new Map(state);
  next.set(u.utteranceId, { text: u.text, final: u.final });
  return next;
}

/** Joins utterances; a space between them unless the boundary is CJK, where one would look wrong. */
export function transcriptText(state: TranscriptState): string {
  let out = "";
  for (const { text } of state.values()) {
    const part = text.trim();
    if (!part) continue;
    if (out && !(isCjk(out[out.length - 1]) && isCjk(part[0]))) out += " ";
    out += part;
  }
  return out;
}

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
function isCjk(ch: string): boolean {
  return CJK.test(ch);
}
