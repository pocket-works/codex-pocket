import type { JsonRpcMessage } from "@codex-pocket/protocol";

export interface PushEvent {
  threadId: string;
  body: string;
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
      if (status === "completed") return { threadId, body: "Codex finished" };
      if (status === "failed") return { threadId, body: "Turn failed" };
      return null;
    }
    case "item/commandExecution/requestApproval": {
      const command = typeof p.command === "string" ? p.command : "a command";
      return { threadId, body: `Approve: ${command.length > 80 ? `${command.slice(0, 77)}…` : command}` };
    }
    case "item/fileChange/requestApproval":
      return { threadId, body: "Approve file changes" };
    case "item/permissions/requestApproval":
      return { threadId, body: "Approve extra permissions" };
    case "item/tool/requestUserInput":
      return { threadId, body: "Codex has a question" };
    case "error": {
      if (p.willRetry) return null;
      const message = (p.error as { message?: string } | undefined)?.message;
      return { threadId, body: message || "Codex hit an error" };
    }
    default:
      return null;
  }
}
