// Pinned threads, per device: the app-server has no pin flag, and the
// official app keeps pins with the account. A pinned thread is listed first.
const KEY = "codex-pocket.pins";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function getPins(): string[] {
  return read();
}

export function isPinned(threadId: string): boolean {
  return read().includes(threadId);
}

/** Pins or unpins; returns the new list, most recently pinned first. */
export function togglePin(threadId: string): string[] {
  const current = read();
  const next = current.includes(threadId) ? current.filter((id) => id !== threadId) : [threadId, ...current];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the pin lasts for this page only.
  }
  return next;
}
