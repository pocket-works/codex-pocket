import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { RpcClient } from "../src/rpc/client.js";
import { Session } from "../src/state/session.js";
import { loadWorkspaceChanges } from "../src/state/workspace-changes.js";

it("reports real uncommitted edits and clears them after commit or restore", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pocket-workspace-git-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  const commit = () => git("-c", "user.name=Test User", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "test fixture");
  try {
    git("init", "-b", "main");
    writeFileSync(join(cwd, "tracked.txt"), "old\n");
    git("add", ".");
    commit();
    const rpc = {
      connectionState: "open",
      start() {},
      notify() {},
      request(method: string, params: { command: string[]; cwd: string }) {
        expect(method).toBe("command/exec");
        const output = spawnSync(params.command[0], params.command.slice(1), { cwd: params.cwd, encoding: "utf8" });
        return Promise.resolve({ stdout: output.stdout, stderr: output.stderr, exitCode: output.status });
      },
      onStateChange: () => () => {},
      onNotification: () => () => {},
      onServerRequest: () => () => {},
    } as unknown as RpcClient;
    const session = new Session(rpc);
    writeFileSync(join(cwd, "tracked.txt"), "new\nextra\n");
    writeFileSync(join(cwd, "untracked.txt"), "hello\n");
    const edited = await loadWorkspaceChanges(session, cwd, "uncommitted");
    expect(edited.totals).toEqual({ files: 2, added: 3, removed: 1 });
    expect(edited.files.map((file) => file.path)).toEqual([join(cwd, "tracked.txt"), join(cwd, "untracked.txt")]);
    git("add", ".");
    expect((await loadWorkspaceChanges(session, cwd, "uncommitted")).totals.files).toBe(2);
    commit();
    expect((await loadWorkspaceChanges(session, cwd, "uncommitted")).totals).toEqual({ files: 0, added: 0, removed: 0 });
    writeFileSync(join(cwd, "tracked.txt"), "another edit\n");
    expect((await loadWorkspaceChanges(session, cwd, "uncommitted")).totals.files).toBe(1);
    git("restore", "tracked.txt");
    expect((await loadWorkspaceChanges(session, cwd, "uncommitted")).files).toEqual([]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
