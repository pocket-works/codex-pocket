import type { v2 } from "@codex-pocket/protocol";

export interface ThreadReadiness {
  unread: boolean;
  pending: boolean;
  since: number;
  turnId: string | null;
}

const KEY = "codex-pocket.threadReadiness";
const MAX_ENTRIES = 500;

export function isPendingTurnFinished(readiness: ThreadReadiness, turn: Pick<v2.Turn, "id" | "status" | "completedAt">): boolean {
  return readiness.pending && turn.status !== "inProgress" &&
    (readiness.turnId !== null ? turn.id === readiness.turnId : typeof turn.completedAt === "number" && turn.completedAt >= readiness.since);
}

export function loadThreadReadiness(): Map<string, ThreadReadiness> {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(entries)) return new Map();
    return new Map(entries.slice(-MAX_ENTRIES).filter((entry): entry is [string, ThreadReadiness] =>
      Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" &&
      entry[1] !== null && typeof entry[1] === "object" &&
      typeof entry[1].unread === "boolean" && typeof entry[1].pending === "boolean" &&
      typeof entry[1].since === "number" && Number.isFinite(entry[1].since) &&
      (entry[1].turnId === null || typeof entry[1].turnId === "string"),
    ));
  } catch {
    return new Map();
  }
}

export function saveThreadReadiness(entries: Map<string, ThreadReadiness>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...entries].slice(-MAX_ENTRIES)));
  } catch {}
}
