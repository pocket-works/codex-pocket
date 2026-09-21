// Per-device presentation preferences for the thread list (not user data,
// so localStorage is fine; the official app keeps these per device too).
export type ListView = "project" | "chronological";

const KEY = "codex-pocket.listView";

export function getListView(): ListView {
  return localStorage.getItem(KEY) === "chronological" ? "chronological" : "project";
}

export function setListView(v: ListView): void {
  localStorage.setItem(KEY, v);
}

/** List sections that can be folded away. Only "Chats" folds, as in the
    official app; projects always stay listed. */
export type ListSection = "chats";

export type CollapsedSections = Record<ListSection, boolean>;

const COLLAPSED_KEY = "codex-pocket.collapsedSections";

const EXPANDED: CollapsedSections = { chats: false };

export function getCollapsedSections(): CollapsedSections {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return { ...EXPANDED };
    const parsed = JSON.parse(raw) as Partial<Record<ListSection, boolean>>;
    return { chats: parsed.chats === true };
  } catch {
    return { ...EXPANDED };
  }
}

export function setSectionCollapsed(section: ListSection, collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify({ ...getCollapsedSections(), [section]: collapsed }));
  } catch {
    // Private mode or blocked storage: the fold lasts for this page only.
  }
}
