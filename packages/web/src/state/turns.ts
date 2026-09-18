import type { v2 } from "@codex-pocket/protocol";
import type { ThreadItem, ThreadViewState, TurnMeta } from "./thread-reducer.js";

// Groups a flat item list into turns the way the official app shows them:
// the user's message, a collapsible "Worked for …" section holding
// reasoning, tool calls and interim commentary, then the final answer.

export type AgentMessage = Extract<ThreadItem, { type: "agentMessage" }>;

export interface TurnGroup {
  turnId: string;
  meta: TurnMeta | null;
  inProgress: boolean;
  userMessages: ThreadItem[];
  work: ThreadItem[];
  final: AgentMessage | null;
}

const NOISE = new Set<ThreadItem["type"]>(["functionCallOutput", "hookPrompt", "enteredReviewMode", "exitedReviewMode"]);

export function groupTurns(view: ThreadViewState): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const byId = new Map<string, TurnGroup>();
  let orphan = 0;
  for (const item of view.items) {
    if (NOISE.has(item.type)) continue;
    // Items without a known turn are shown in their own group rather than dropped.
    const turnId = view.itemTurns[item.id] ?? `orphan-${item.type === "userMessage" ? ++orphan : orphan}`;
    let g = byId.get(turnId);
    if (!g) {
      const meta = view.turns[turnId] ?? null;
      g = { turnId, meta, inProgress: view.activeTurnId === turnId || meta?.status === "inProgress", userMessages: [], work: [], final: null };
      byId.set(turnId, g);
      groups.push(g);
    }
    if (item.type === "userMessage") g.userMessages.push(item);
    else g.work.push(item);
  }
  for (const g of groups) promoteFinal(g);
  return groups;
}

// The final answer is the last agent message of the turn unless Codex
// labelled it interim commentary. Everything before it is "work".
function promoteFinal(g: TurnGroup): void {
  for (let i = g.work.length - 1; i >= 0; i--) {
    const item = g.work[i];
    if (item.type !== "agentMessage") continue;
    if (item.phase === "commentary") break;
    g.final = item;
    g.work.splice(i, 1);
    break;
  }
}

/** "1m 55s", "36s", "2h 3m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function turnDurationMs(meta: TurnMeta | null, now: number): number | null {
  if (!meta) return null;
  if (meta.durationMs !== null) return meta.durationMs;
  if (meta.startedAt === null) return null;
  return (meta.completedAt ?? now) - meta.startedAt;
}

// One-line label for a tool row, e.g. `Read main.py`, `Js "查看天气"`.
export function toolLabel(item: ThreadItem): string {
  switch (item.type) {
    case "commandExecution": {
      const action = item.commandActions?.[0];
      if (action?.type === "read") return `Read ${action.name}`;
      if (action?.type === "listFiles") return `List files${action.path ? ` in ${action.path}` : ""}`;
      if (action?.type === "search") return `Search${action.query ? ` "${action.query}"` : ""}`;
      return stripShellWrapper(item.command);
    }
    case "mcpToolCall":
      return `${item.tool}${quotedArg(item.arguments)}`;
    case "dynamicToolCall":
      return `${item.tool}${quotedArg(item.arguments)}`;
    case "fileChange":
      return `Edited ${item.changes.length} file${item.changes.length === 1 ? "" : "s"}`;
    case "webSearch":
      return `Searched "${item.query}"`;
    case "reasoning":
      return "Thinking";
    case "contextCompaction":
      return "Context compacted";
    case "imageView":
      return `Viewed ${item.path.split("/").pop() ?? "image"}`;
    default:
      return item.type;
  }
}

function quotedArg(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const pick = ["title", "name", "description", "query", "command", "path"].map((k) => a[k]).find((v) => typeof v === "string" && v.trim());
  const first = pick ?? Object.values(a).find((v) => typeof v === "string" && v.trim());
  if (typeof first !== "string") return "";
  const text = first.replace(/\s+/g, " ").trim();
  return ` "${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;
}

/** `/bin/zsh -lc 'ls -la'` -> `ls -la`. */
export function stripShellWrapper(command: string): string {
  const m = command.match(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$/);
  return m ? m[2] : command;
}

export function isToolItem(item: ThreadItem): boolean {
  return item.type === "commandExecution" || item.type === "mcpToolCall" || item.type === "dynamicToolCall" || item.type === "fileChange" || item.type === "webSearch" || item.type === "imageView";
}

export type TurnMetaLike = v2.Turn;
