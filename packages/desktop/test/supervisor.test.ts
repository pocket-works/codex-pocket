import { describe, expect, it, vi } from "vitest";
import { HostSupervisor, type HostChild, type HostState, type HostStatus } from "../src/supervisor.js";

class FakeChild implements HostChild {
  killed = false;
  private exitHandlers: Array<(code: number | null) => void> = [];
  onExit(handler: (code: number | null) => void): void {
    this.exitHandlers.push(handler);
  }
  kill(): void {
    this.killed = true;
  }
  exit(code: number | null): void {
    for (const h of this.exitHandlers) h(code);
  }
}

const STATUS: HostStatus = { publicUrl: "http://10.0.0.2:7333", codexConnected: true, deviceCount: 1 };

function setup(probeResults: Array<HostStatus | null> = []) {
  const children: FakeChild[] = [];
  const states: HostState[] = [];
  let probes = 0;
  const probe = vi.fn(async () => probeResults[Math.min(probes++, probeResults.length - 1)] ?? null);
  const sup = new HostSupervisor({
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    probe,
    pollMs: 5,
    startTimeoutMs: 100,
    onChange: (s) => states.push(s),
  });
  return { sup, children, states, probe };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("HostSupervisor", () => {
  it("starts stopped", () => {
    const { sup } = setup();
    expect(sup.state).toEqual({ kind: "stopped" });
  });

  it("spawns the host and reports running once the admin endpoint answers", async () => {
    const { sup, children, states } = setup([null, STATUS]);
    sup.start();
    expect(children).toHaveLength(1);
    expect(sup.state).toEqual({ kind: "starting" });
    await settle();
    expect(sup.state).toEqual({ kind: "running", status: STATUS });
    expect(states.map((s) => s.kind)).toEqual(["starting", "running"]);
  });

  it("keeps refreshing status while running", async () => {
    const updated = { ...STATUS, codexConnected: false };
    const { sup } = setup([STATUS, updated]);
    sup.start();
    await settle();
    expect(sup.state).toEqual({ kind: "running", status: updated });
  });

  it("start is idempotent", () => {
    const { sup, children } = setup();
    sup.start();
    sup.start();
    expect(children).toHaveLength(1);
  });

  it("stop kills the child and resolves when it exits", async () => {
    const { sup, children } = setup([STATUS]);
    sup.start();
    await settle();
    const stopping = sup.stop();
    expect(children[0].killed).toBe(true);
    children[0].exit(0);
    await stopping;
    expect(sup.state).toEqual({ kind: "stopped" });
  });

  it("stop without a running host resolves immediately", async () => {
    const { sup } = setup();
    await sup.stop();
    expect(sup.state).toEqual({ kind: "stopped" });
  });

  it("an unexpected exit becomes an error state", async () => {
    const { sup, children, probe } = setup([STATUS]);
    sup.start();
    await settle();
    children[0].exit(1);
    expect(sup.state).toEqual({ kind: "error", message: "host exited with code 1" });
    const calls = probe.mock.calls.length;
    await settle();
    expect(probe.mock.calls.length).toBe(calls);
  });

  it("restart stops then starts a fresh child", async () => {
    const { sup, children } = setup([STATUS]);
    sup.start();
    await settle();
    const restarting = sup.restart();
    children[0].exit(0);
    await restarting;
    expect(children).toHaveLength(2);
    expect(sup.state.kind).toBe("starting");
  });

  it("a probe that never answers times out into an error", async () => {
    const { sup, children } = setup([null]);
    sup.start();
    await new Promise((r) => setTimeout(r, 120));
    expect(children[0].killed).toBe(true);
    expect(sup.state).toEqual({ kind: "error", message: "host did not start within 100ms" });
  });
});
