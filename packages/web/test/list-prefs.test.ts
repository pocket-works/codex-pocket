import { beforeEach, describe, expect, it } from "vitest";
import { getCollapsedSections, getListView, setListView, setSectionCollapsed } from "../src/state/list-prefs.js";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

describe("list view preference", () => {
  beforeEach(() => memory.clear());

  it("defaults to the project view", () => {
    expect(getListView()).toBe("project");
  });

  it("remembers the chronological choice", () => {
    setListView("chronological");
    expect(getListView()).toBe("chronological");
  });
});

describe("collapsed sections", () => {
  beforeEach(() => memory.clear());

  it("starts with every section open", () => {
    expect(getCollapsedSections()).toEqual({ chats: false, projects: false });
  });

  it("remembers one folded section without touching the other", () => {
    setSectionCollapsed("chats", true);
    expect(getCollapsedSections()).toEqual({ chats: true, projects: false });
    setSectionCollapsed("projects", true);
    expect(getCollapsedSections()).toEqual({ chats: true, projects: true });
    setSectionCollapsed("chats", false);
    expect(getCollapsedSections()).toEqual({ chats: false, projects: true });
  });

  it("falls back to open when storage holds junk", () => {
    localStorage.setItem("codex-pocket.collapsedSections", "{not json");
    expect(getCollapsedSections()).toEqual({ chats: false, projects: false });
    localStorage.setItem("codex-pocket.collapsedSections", JSON.stringify({ chats: "yes", projects: 1 }));
    expect(getCollapsedSections()).toEqual({ chats: false, projects: false });
  });
});

