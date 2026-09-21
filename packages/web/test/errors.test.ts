import { describe, expect, it } from "vitest";
import { CONNECTION_ERROR, RpcError } from "../src/rpc/client.js";
import { friendlyError } from "../src/state/errors.js";

describe("friendlyError", () => {
  it("explains a dropped socket", () => {
    expect(friendlyError(new RpcError(CONNECTION_ERROR, "connection closed"))).toMatch(/Reconnecting/);
  });

  it("explains Codex being down on the Mac", () => {
    expect(friendlyError(new Error("connection closed before response: socket hang up"))).toMatch(/Codex isn't running/);
  });

  it("passes other messages through untouched", () => {
    expect(friendlyError(new Error("turn is not steerable"))).toBe("turn is not steerable");
    expect(friendlyError("plain")).toBe("plain");
  });
});
