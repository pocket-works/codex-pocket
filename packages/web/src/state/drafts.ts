import { emptyDraft, type Draft } from "./compose.js";

// Unsent composer text, per thread, so backing out to the list, switching
// threads, or iOS reloading a backgrounded tab does not eat what was typed.
// Images keep only their path on the Mac; the preview is fetched back from
// the host when the draft is restored.

const PREFIX = "codex-pocket.draft.";

interface StoredDraft {
  text: string;
  mentions: Draft["mentions"];
  skill: Draft["skill"];
  images: { id: string; path: string }[];
}

export function loadDraft(key: string): Draft {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return emptyDraft;
    const d = JSON.parse(raw) as Partial<StoredDraft>;
    return {
      text: typeof d.text === "string" ? d.text : "",
      mentions: Array.isArray(d.mentions) ? d.mentions : [],
      skill: d.skill ?? null,
      images: Array.isArray(d.images) ? d.images.map((i) => ({ ...i, previewUrl: "" })) : [],
    };
  } catch {
    return emptyDraft;
  }
}

/** Stores the draft, or forgets it when there is nothing left to send. */
export function saveDraft(key: string, draft: Draft): void {
  try {
    if (isEmptyDraft(draft)) {
      localStorage.removeItem(PREFIX + key);
      return;
    }
    const stored: StoredDraft = { text: draft.text, mentions: draft.mentions, skill: draft.skill, images: draft.images.map(({ id, path }) => ({ id, path })) };
    localStorage.setItem(PREFIX + key, JSON.stringify(stored));
  } catch {
    // Private mode or a full store: the draft lives for this page only.
  }
}

export function isEmptyDraft(draft: Draft): boolean {
  return draft.text === "" && draft.images.length === 0 && draft.skill === null;
}
