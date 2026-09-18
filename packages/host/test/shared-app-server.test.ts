import { describe, expect, it } from "vitest";
import { ensureSharedAppServer, SHARED_APP_SERVER_ARGS } from "../src/codex/shared-app-server.js";

describe("ensureSharedAppServer", () => {
  it("adopts an already-running listener without spawning", async () => {
    let spawned = 0;
    const url = await ensureSharedAppServer({
      port: 7999,
      logFile: "/dev/null",
      probe: async () => true,
      spawnProcess: () => {
        spawned++;
      },
    });
    expect(url).toBe("ws://127.0.0.1:7999/");
    expect(spawned).toBe(0);
  });

  it("spawns with the desktop app's flags and waits for /readyz", async () => {
    let calls = 0;
    let spawnedWith: string[] | null = null;
    const url = await ensureSharedAppServer({
      port: 7998,
      binary: "/fake/codex",
      logFile: "/dev/null",
      probe: async (u) => {
        expect(u).toBe("http://127.0.0.1:7998/readyz");
        calls++;
        return calls >= 3;
      },
      spawnProcess: (_b, args) => {
        spawnedWith = args;
      },
    });
    expect(url).toBe("ws://127.0.0.1:7998/");
    expect(spawnedWith).toEqual([...SHARED_APP_SERVER_ARGS, "--listen", "ws://127.0.0.1:7998"]);
  });

  it("fails loudly when the listener never comes up", async () => {
    await expect(
      ensureSharedAppServer({ port: 7997, binary: "/fake/codex", logFile: "/tmp/x.log", probe: async () => false, spawnProcess: () => {}, readyTimeoutMs: 300 }),
    ).rejects.toThrow(/did not become ready/);
  });
});
