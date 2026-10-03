import { describe, expect, it } from "vitest";
import { buildUserInput, mentionQuery, sendBlocker, type Draft } from "../src/state/compose.js";

const empty: Draft = { text: "", images: [], files: [], mentions: [], skill: null };

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

  it("includes CSV names and readable host paths even without a message", () => {
    const files = [{ id: "csv", name: "sales.csv", path: "/uploads/abc.csv" }];
    expect(buildUserInput({ ...empty, files })).toEqual([
      { type: "text", text: 'Attached files:\n"sales.csv": "/uploads/abc.csv"', text_elements: [] },
    ]);
    expect(buildUserInput({ ...empty, text: "Analyze @a.ts", mentions: [{ name: "a.ts", path: "/a.ts" }], files })).toEqual([
      { type: "text", text: 'Analyze @a.ts\n\nAttached files:\n"sales.csv": "/uploads/abc.csv"', text_elements: [{ byteRange: { start: 8, end: 13 }, placeholder: "a.ts" }] },
      { type: "mention", name: "a.ts", path: "/a.ts" },
    ]);
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

describe("sendBlocker", () => {
  const img = { id: "i", path: "/p.png", previewUrl: "blob:x" };
  const draft = (images = 0): Draft => ({ ...empty, text: "hi", images: Array.from({ length: images }, () => img) });
  const model = (name: string, modalities: ("text" | "image")[]) => ({ model: name, inputModalities: modalities }) as never;

  it("waits for uploads to finish", () => {
    expect(sendBlocker({ draft: draft(1), uploading: 1, model: "m", models: [model("m", ["text", "image"])] })).toBe("Files uploading…");
  });

  it("refuses images the model cannot take", () => {
    expect(sendBlocker({ draft: draft(1), uploading: 0, model: "m", models: [model("m", ["text"])] })).toBe("Remove images or switch models to send this message");
  });

  it("allows text, images on capable models, and unknown models", () => {
    expect(sendBlocker({ draft: draft(0), uploading: 0, model: "m", models: [model("m", ["text"])] })).toBeNull();
    expect(sendBlocker({ draft: draft(1), uploading: 0, model: "m", models: [model("m", ["text", "image"])] })).toBeNull();
    expect(sendBlocker({ draft: draft(1), uploading: 0, model: "other", models: [model("m", ["text"])] })).toBeNull();
  });

  it("allows CSV attachments on text-only models", () => {
    expect(sendBlocker({ draft: { ...empty, files: [{ id: "csv", name: "a.csv", path: "/a.csv" }] }, uploading: 0, model: "m", models: [model("m", ["text"])] })).toBeNull();
  });
});
