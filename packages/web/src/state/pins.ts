// Pinned threads, per device: the app-server has no pin flag, and the
// official app keeps pins with the account. A pinned thread is listed first.
import { scopedKey } from "./computers.js";

const KEY = "codex-pocket.pins";

function read(computerId?: string): string[] {
  try {
    const raw = localStorage.getItem(scopedKey(KEY, computerId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function getPins(computerId?: string): string[] {
  return read(computerId);
}

export function isPinned(threadId: string, computerId?: string): boolean {
  return read(computerId).includes(threadId);
}

/** Pins or unpins; returns the new list, most recently pinned first. */
export function togglePin(threadId: string, computerId?: string): string[] {
  const current = read(computerId);
  const next = current.includes(threadId) ? current.filter((id) => id !== threadId) : [threadId, ...current];
  try {
    localStorage.setItem(scopedKey(KEY, computerId), JSON.stringify(next));
  } catch {
    // Storage blocked: the pin lasts for this page only.
  }
  return next;
}
