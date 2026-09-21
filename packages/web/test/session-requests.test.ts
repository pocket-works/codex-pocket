import { describe, expect, it } from "vitest";
import type { JsonRpcRequest } from "@codex-pocket/protocol";
import type { RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";
import { ELICITATION_METHOD } from "../src/state/thread-reducer.js";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
} as unknown as Storage;

const resumed = (id: string) => ({ thread: { id }, model: "m", cwd: "/p", approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: { type: "workspaceWrite" }, reasoningEffort: null, serviceTier: null });

// Records what the phone answers, and lets a test push server requests in.
function stubRpc() {
  const answers: { id: unknown; result?: unknown; error?: unknown }[] = [];
  let onRequest: (req: JsonRpcRequest) => void = () => {};
  const rpc = {
    connectionState: "open",
    start() {},
    notify() {},
    request(method: string, params: { threadId?: string }) {
      if (method === "thread/resume") return Promise.resolve(resumed(params.threadId ?? ""));
      if (method === "thread/items/list" || method === "thread/turns/list" || method === "thread/queue/list") return Promise.resolve({ data: [], nextCursor: null });
      return Promise.resolve({});
    },
    respond(id: unknown, result: unknown) {
      answers.push({ id, result });
    },
    respondError(id: unknown, code: number, message: string) {
      answers.push({ id, error: { code, message } });
    },
    onStateChange() {
      return () => {};
    },
    onNotification() {
      return () => {};
    },
    onServerRequest(l: (req: JsonRpcRequest) => void) {
      onRequest = l;
      return () => {};
    },
  };
  return { rpc: rpc as unknown as RpcClient, answers, send: (req: JsonRpcRequest) => onRequest(req) };
}

const approval = (id: number, threadId: string): JsonRpcRequest => ({ jsonrpc: "2.0", id, method: "item/commandExecution/requestApproval", params: { threadId, itemId: "c1", command: "ls" } });

describe("server requests", () => {
  it("shows an approval that arrived for a background thread once that thread opens", async () => {
    const { rpc, send } = stubRpc();
    const session = new Session(rpc);
    await session.openThread("A");
    send(approval(7, "B"));
    expect(session.store.get().open?.view.approvals).toEqual([]);
    await session.openThread("B");
    expect(session.store.get().open?.view.approvals.map((a) => a.id)).toEqual([7]);
  });

  it("forgets a request once answered or resolved elsewhere", async () => {
    const { rpc, send, answers } = stubRpc();
    const session = new Session(rpc);
    send(approval(1, "B"));
    send(approval(2, "B"));
    session.answerApproval(1, { decision: "accept" });
    session.handleNotification({ jsonrpc: "2.0", method: "serverRequest/resolved", params: { requestId: 2 } });
    await session.openThread("B");
    expect(session.store.get().open?.view.approvals).toEqual([]);
    expect(answers).toEqual([{ id: 1, result: { decision: "accept" } }]);
  });

  it("answers currentTime/read itself and declines what a phone cannot serve", () => {
    const { rpc, send, answers } = stubRpc();
    new Session(rpc);
    send({ jsonrpc: "2.0", id: 3, method: "currentTime/read", params: {} });
    send({ jsonrpc: "2.0", id: 4, method: "item/tool/call", params: { threadId: "A", tool: "x" } });
    expect(answers[0]).toMatchObject({ id: 3, result: { currentTimeAt: expect.any(Number) } });
    expect(answers[1]).toMatchObject({ id: 4, error: { code: -32601 } });
  });

  it("queues an MCP elicitation like an approval and answers it in the protocol's shape", async () => {
    const { rpc, send, answers } = stubRpc();
    const session = new Session(rpc);
    await session.openThread("A");
    send({ jsonrpc: "2.0", id: 9, method: ELICITATION_METHOD, params: { threadId: "A", turnId: null, serverName: "jira", mode: "form", _meta: null, message: "Which project?", requestedSchema: { type: "object", properties: { project: { type: "string" } }, required: ["project"] } } });
    expect(session.store.get().open?.view.approvals[0]).toMatchObject({ id: 9, method: ELICITATION_METHOD });
    session.answerElicitation(9, { action: "accept", content: { project: "POCKET" }, _meta: null });
    expect(answers).toEqual([{ id: 9, result: { action: "accept", content: { project: "POCKET" }, _meta: null } }]);
    expect(session.store.get().open?.view.approvals).toEqual([]);
  });
});
