import { describe, expect, it } from "vitest";
import { applyTranscript, transcriptText, type TranscriptState } from "../src/state/transcript.js";

function build(updates: Array<[string, string, boolean]>): TranscriptState {
  let state: TranscriptState = new Map();
  for (const [utteranceId, text, final] of updates) state = applyTranscript(state, { utteranceId, text, final });
  return state;
}

describe("dictation transcript", () => {
  it("replaces an utterance's text with each revision until it is final", () => {
    const state = build([
      ["u1", "帮我", false],
      ["u1", "帮我把 Composer", false],
      ["u1", "帮我把 Composer 改一下。", true],
    ]);
    expect(transcriptText(state)).toBe("帮我把 Composer 改一下。");
  });

  it("ignores a late revision after the final", () => {
    const state = build([
      ["u1", "hello world", true],
      ["u1", "hello", false],
    ]);
    expect(transcriptText(state)).toBe("hello world");
  });

  it("keeps utterances in arrival order and joins them sensibly", () => {
    const state = build([
      ["u1", "先给我一个方案。", true],
      ["u2", "然后再改。", false],
      ["u3", "Then ship it.", true],
      ["u4", "  ", true],
    ]);
    expect(transcriptText(state)).toBe("先给我一个方案。然后再改。 Then ship it.");
  });

  it("does not mutate the previous state", () => {
    const first = build([["u1", "a", false]]);
    const second = applyTranscript(first, { utteranceId: "u1", text: "ab", final: false });
    expect(transcriptText(first)).toBe("a");
    expect(transcriptText(second)).toBe("ab");
  });
});
