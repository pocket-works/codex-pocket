import { beforeEach, describe, expect, it } from "vitest";
import { emptyDraft } from "../src/state/compose.js";
import { isEmptyDraft, loadDraft, saveDraft } from "../src/state/drafts.js";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

describe("drafts", () => {
  beforeEach(() => memory.clear());

  it("round-trips text, mentions and the skill, keeping only the image's path", () => {
    saveDraft("t1", {
      text: "look at @a.ts",
      mentions: [{ name: "a.ts", path: "/p/a.ts" }],
      skill: { name: "review", path: "/s/review" },
      images: [{ id: "i1", path: "/up/abc.jpg", previewUrl: "blob:local" }],
    });
    expect(loadDraft("t1")).toEqual({
      text: "look at @a.ts",
      mentions: [{ name: "a.ts", path: "/p/a.ts" }],
      skill: { name: "review", path: "/s/review" },
      images: [{ id: "i1", path: "/up/abc.jpg", previewUrl: "" }],
    });
  });

  it("forgets the draft once it is empty", () => {
    saveDraft("t1", { ...emptyDraft, text: "wip" });
    saveDraft("t1", emptyDraft);
    expect(memory.size).toBe(0);
    expect(loadDraft("t1")).toEqual(emptyDraft);
  });

  it("keeps drafts apart per key and survives garbage", () => {
    saveDraft("t1", { ...emptyDraft, text: "one" });
    memory.set("codex-pocket.draft.t2", "{not json");
    expect(loadDraft("t1").text).toBe("one");
    expect(loadDraft("t2")).toEqual(emptyDraft);
    expect(loadDraft("t3")).toEqual(emptyDraft);
  });

  it("treats whitespace-only text as a draft worth keeping but images and skills as content", () => {
    expect(isEmptyDraft(emptyDraft)).toBe(true);
    expect(isEmptyDraft({ ...emptyDraft, skill: { name: "x", path: "/x" } })).toBe(false);
    expect(isEmptyDraft({ ...emptyDraft, images: [{ id: "i", path: "/p", previewUrl: "" }] })).toBe(false);
  });
});
