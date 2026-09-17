import { describe, expect, it } from "vitest";
import { buildUserInput, mentionQuery, type Draft } from "../src/state/compose.js";

const empty: Draft = { text: "", images: [], mentions: [], skill: null };

describe("buildUserInput", () => {
  it("sends plain text as one text input", () => {
    expect(buildUserInput({ ...empty, text: "hi" })).toEqual([{ type: "text", text: "hi", text_elements: [] }]);
  });

  it("puts images after the text as localImage inputs", () => {
    const out = buildUserInput({ ...empty, text: "look", images: [{ id: "a", path: "/tmp/a.jpg", previewUrl: "blob:a" }] });
    expect(out).toEqual([
      { type: "text", text: "look", text_elements: [] },
      { type: "localImage", path: "/tmp/a.jpg" },
    ]);
  });

  it("marks @mentions in the text and adds mention inputs for the ones still present", () => {
    const out = buildUserInput({
      ...empty,
      text: "fix @cli.ts and @gone.ts please",
      mentions: [
        { name: "cli.ts", path: "/p/src/cli.ts" },
        { name: "removed.ts", path: "/p/removed.ts" },
      ],
    });
    expect(out).toEqual([
      { type: "text", text: "fix @cli.ts and @gone.ts please", text_elements: [{ byteRange: { start: 4, end: 11 }, placeholder: "cli.ts" }] },
      { type: "mention", name: "cli.ts", path: "/p/src/cli.ts" },
    ]);
  });

  it("uses byte offsets, not code units, for text elements", () => {
    const out = buildUserInput({ ...empty, text: "修复 @a.ts", mentions: [{ name: "a.ts", path: "/a.ts" }] });
    expect(out[0]).toMatchObject({ text_elements: [{ byteRange: { start: 7, end: 12 } }] });
  });

  it("prepends the skill input", () => {
    const out = buildUserInput({ ...empty, text: "do it", skill: { name: "deploy", path: "/skills/deploy/SKILL.md" } });
    expect(out[0]).toEqual({ type: "skill", name: "deploy", path: "/skills/deploy/SKILL.md" });
  });

  it("drops an empty text input when only attachments are sent", () => {
    expect(buildUserInput({ ...empty, images: [{ id: "a", path: "/a.png", previewUrl: "" }] })).toEqual([{ type: "localImage", path: "/a.png" }]);
  });
});

describe("mentionQuery", () => {
  it("finds the @token the caret is in", () => {
    expect(mentionQuery("fix @cli", 8)).toEqual({ start: 4, query: "cli" });
    expect(mentionQuery("fix @src/cl and", 11)).toEqual({ start: 4, query: "src/cl" });
  });

  it("returns null outside a token or for emails", () => {
    expect(mentionQuery("fix @cli done", 13)).toBeNull();
    expect(mentionQuery("mail me@x.com", 13)).toBeNull();
    expect(mentionQuery("plain", 5)).toBeNull();
  });
});
