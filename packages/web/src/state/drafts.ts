import { emptyDraft, type Draft } from "./compose.js";
import { scopedKey } from "./computers.js";

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

export function loadDraft(key: string, computerId?: string): Draft {
  try {
    const raw = localStorage.getItem(scopedKey(PREFIX + key, computerId));
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
export function saveDraft(key: string, draft: Draft, computerId?: string): void {
  try {
    if (isEmptyDraft(draft)) {
      localStorage.removeItem(scopedKey(PREFIX + key, computerId));
      return;
    }
    const stored: StoredDraft = { text: draft.text, mentions: draft.mentions, skill: draft.skill, images: draft.images.map(({ id, path }) => ({ id, path })) };
    localStorage.setItem(scopedKey(PREFIX + key, computerId), JSON.stringify(stored));
  } catch {
    // Private mode or a full store: the draft lives for this page only.
  }
}

export function isEmptyDraft(draft: Draft): boolean {
  return draft.text === "" && draft.images.length === 0 && draft.skill === null;
}

export function hasUnconfirmedSend(key: string, computerId?: string): boolean {
  try { return localStorage.getItem(scopedKey(`codex-pocket.unconfirmed.${key}`, computerId)) === "1"; }
  catch { return false; }
}

export function setUnconfirmedSend(key: string, pending: boolean, computerId?: string): void {
  try {
    const storageKey = scopedKey(`codex-pocket.unconfirmed.${key}`, computerId);
    if (pending) localStorage.setItem(storageKey, "1");
    else localStorage.removeItem(storageKey);
  } catch {}
}
