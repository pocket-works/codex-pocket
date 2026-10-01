import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostInstanceId } from "../src/config/paths.js";

afterEach(() => vi.unstubAllEnvs());

describe("host identity", () => {
  it("persists the same instance identity across starts", () => {
    const home = mkdtempSync(join(tmpdir(), "cp-identity-"));
    vi.stubEnv("CODEX_POCKET_HOME", home);
    try {
      const id = hostInstanceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(hostInstanceId()).toBe(id);
      expect(readFileSync(join(home, "host.id"), "utf8")).toBe(id);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
