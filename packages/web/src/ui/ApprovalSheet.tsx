import type { Session } from "../state/session.js";
import type { PendingApproval } from "../state/thread-reducer.js";

// One approval at a time, newest-first is not what we want: the oldest
// blocks Codex, so ThreadView passes approvals[0].
export function ApprovalSheet({ session, approval }: { session: Session; approval: PendingApproval }) {
  const p = approval.params as { command?: string; cwd?: string; reason?: string; changes?: unknown; grantRoot?: string };
  const isCommand = approval.method === "item/commandExecution/requestApproval";
  const isFile = approval.method === "item/fileChange/requestApproval";
  const isPermissions = approval.method === "item/permissions/requestApproval";

  function decide(decision: string) {
    session.answerApproval(approval.id, { decision });
  }

  // Permission requests answer with the granted profile, not a decision:
  // granting nothing is the decline.
  function grant(scope: "turn" | "session" | null) {
    const requested = (approval.params as { permissions?: { network?: unknown; fileSystem?: unknown } }).permissions ?? {};
    const permissions = scope ? { network: requested.network ?? undefined, fileSystem: requested.fileSystem ?? undefined } : {};
    session.answerApproval(approval.id, { permissions, scope: scope ?? "turn" });
  }

  return (
    <div className="sheet-backdrop">
      <div className="sheet approval">
        <h2>{isCommand ? "Run command?" : isFile ? "Apply file changes?" : "Grant permissions?"}</h2>
        {p.reason && <p className="muted">{p.reason}</p>}
        {isCommand && <pre className="mono">{p.command}</pre>}
        {p.cwd && <p className="muted small">{p.cwd}</p>}
        {isFile && p.grantRoot && <p className="muted small">Grant write access to {p.grantRoot}</p>}
        {isPermissions && (
          <pre className="mono small">{JSON.stringify((approval.params as { permissions?: unknown }).permissions, null, 2)}</pre>
        )}
        <div className="approval-actions">
          <button className="danger" onClick={() => (isPermissions ? grant(null) : decide("decline"))}>
            Decline
          </button>
          <button onClick={() => (isPermissions ? grant("session") : decide("acceptForSession"))}>Allow for session</button>
          <button className="primary" onClick={() => (isPermissions ? grant("turn") : decide("accept"))}>
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
