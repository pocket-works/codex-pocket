import type { JsonRpcMessage } from "@codex-pocket/protocol";

export interface PushEvent {
  threadId: string;
  body: string;
  kind: "turn-completed" | "turn-failed" | "approval" | "input" | "error";
}

// Which upstream messages deserve a push, and what to say. Kept pure so the
// mapping is easy to test and extend.
export function pushEventFor(msg: JsonRpcMessage): PushEvent | null {
  if (!("method" in msg)) return null;
  const p = (msg.params ?? {}) as Record<string, unknown>;
  const threadId = typeof p.threadId === "string" ? p.threadId : null;
  if (!threadId) return null;
  switch (msg.method) {
    case "turn/completed": {
      const status = (p.turn as { status?: string } | undefined)?.status;
      if (status === "completed") return { threadId, body: "Codex finished", kind: "turn-completed" };
      if (status === "failed") return { threadId, body: "Turn failed", kind: "turn-failed" };
      return null;
    }
    case "item/commandExecution/requestApproval": {
      const command = typeof p.command === "string" ? p.command : "a command";
      return { threadId, body: `Approve: ${command.length > 80 ? `${command.slice(0, 77)}…` : command}`, kind: "approval" };
    }
    case "item/fileChange/requestApproval":
      return { threadId, body: "Approve file changes", kind: "approval" };
    case "item/permissions/requestApproval":
      return { threadId, body: "Approve extra permissions", kind: "approval" };
    case "item/tool/requestUserInput":
      return { threadId, body: "Codex has a question", kind: "input" };
    case "error": {
      if (p.willRetry) return null;
      const message = (p.error as { message?: string } | undefined)?.message;
      return { threadId, body: message || "Codex hit an error", kind: "error" };
    }
    default:
      return null;
  }
}
