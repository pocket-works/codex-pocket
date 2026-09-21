// Owns the host process: the app starts it, watches it, and stops it on
// quit. Electron-free so the state machine can be tested on its own.

export interface HostStatus {
  publicUrl: string | null;
  codexConnected: boolean;
  deviceCount: number;
}

export type HostState =
  | { kind: "stopped" }
  | { kind: "starting" }
  | { kind: "running"; status: HostStatus }
  | { kind: "error"; message: string };

export interface HostChild {
  onExit(handler: (code: number | null) => void): void;
  kill(): void;
}

export interface SupervisorOptions {
  spawn: () => HostChild;
  /** Asks the host's admin endpoint for its status; null while it is not answering yet. */
  probe: () => Promise<HostStatus | null>;
  onChange: (state: HostState) => void;
  pollMs?: number;
  startTimeoutMs?: number;
}

export class HostSupervisor {
  private readonly opts: Required<SupervisorOptions>;
  private child: HostChild | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private stopping: Promise<void> | null = null;
  private current: HostState = { kind: "stopped" };

  constructor(opts: SupervisorOptions) {
    this.opts = { pollMs: 2000, startTimeoutMs: 20_000, ...opts };
  }

  get state(): HostState {
    return this.current;
  }

  start(): void {
    if (this.child) return;
    const child = this.opts.spawn();
    this.child = child;
    this.startedAt = Date.now();
    child.onExit((code) => this.handleExit(child, code));
    this.setState({ kind: "starting" });
    this.schedulePoll(0);
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const child = this.child;
    if (!child) return Promise.resolve();
    this.stopping = new Promise<void>((resolve) => {
      child.onExit(() => resolve());
      child.kill();
    }).then(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  async restart(): Promise<void> {
    await this.stop();
    this.start();
  }

  private handleExit(child: HostChild, code: number | null): void {
    if (this.child !== child) return;
    this.child = null;
    this.clearPoll();
    if (this.stopping) this.setState({ kind: "stopped" });
    else this.setState({ kind: "error", message: `host exited with code ${code ?? "null"}` });
  }

  private schedulePoll(delay: number): void {
    this.clearPoll();
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private clearPoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async poll(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const status = await this.opts.probe().catch(() => null);
    if (this.child !== child) return;
    if (status) {
      this.setState({ kind: "running", status });
    } else if (this.current.kind === "starting" && Date.now() - this.startedAt >= this.opts.startTimeoutMs) {
      // Something is wrong; kill it so the exit handler does not mask this.
      this.child = null;
      child.kill();
      this.setState({ kind: "error", message: `host did not start within ${this.opts.startTimeoutMs}ms` });
      return;
    }
    this.schedulePoll(this.opts.pollMs);
  }

  private setState(state: HostState): void {
    // Status polls mostly return the same thing; only real changes go out.
    if (JSON.stringify(state) === JSON.stringify(this.current)) return;
    this.current = state;
    this.opts.onChange(state);
  }
}
