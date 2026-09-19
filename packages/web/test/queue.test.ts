import { beforeEach, describe, expect, it } from "vitest";
import { getFollowUpMode, setFollowUpMode, summarizeQueued } from "../src/state/queue.js";

// The test environment is node; a Map is all the preference code needs.
const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

describe("summarizeQueued", () => {
  it("keeps the text and counts images", () => {
    const q = summarizeQueued({
      id: "q1",
      clientUserMessageId: "c1",
      input: [
        { type: "text", text: "fix the tests", text_elements: [] },
        { type: "localImage", path: "/a.png" },
        { type: "localImage", path: "/b.png" },
      ],
    });
    expect(q).toEqual({ id: "q1", text: "fix the tests", imageCount: 2, input: expect.any(Array) });
  });

  it("describes an image-only submission", () => {
    const q = summarizeQueued({ id: "q2", clientUserMessageId: "c2", input: [{ type: "localImage", path: "/a.png" }] });
    expect(q.text).toBe("");
    expect(q.imageCount).toBe(1);
  });

  it("shows the skill when a skill is attached without text", () => {
    const q = summarizeQueued({ id: "q3", clientUserMessageId: "c3", input: [{ type: "skill", name: "deploy", path: "/s" }] });
    expect(q.text).toBe("/deploy");
  });
});

describe("follow-up preference", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to steer, like the official app", () => {
    expect(getFollowUpMode()).toBe("steer");
  });

  it("persists queue mode per device", () => {
    setFollowUpMode("queue");
    expect(getFollowUpMode()).toBe("queue");
    setFollowUpMode("steer");
    expect(getFollowUpMode()).toBe("steer");
  });
});
