import { describe, expect, it } from "vitest";
import type { RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";

describe("Session.readPdfFile", () => {
  it("reads a PDF as a binary blob through fs/readFile", async () => {
    const calls: unknown[] = [];
    const rpc = {
      connectionState: "open",
      start() {},
      notify() {},
      request(method: string, params: unknown) {
        calls.push({ method, params });
        return Promise.resolve({ dataBase64: Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff]).toString("base64") });
      },
      onStateChange: () => () => {},
      onNotification: () => () => {},
      onServerRequest: () => () => {},
    } as unknown as RpcClient;

    const pdf = await new Session(rpc).readPdfFile("/project/output/清华池.pdf");
    expect(calls).toEqual([{ method: "fs/readFile", params: { path: "/project/output/清华池.pdf" } }]);
    expect(pdf.type).toBe("application/pdf");
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0xff]));
  });
});
