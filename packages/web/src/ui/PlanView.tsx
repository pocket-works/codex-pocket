import type { TurnPlan } from "../state/thread-reducer.js";

const MARK: Record<string, string> = { completed: "✓", inProgress: "›", pending: "○" };

// Structured todo list from `turn/plan/updated`; replaces itself each update.
export function PlanView({ plan }: { plan: TurnPlan }) {
  const done = plan.steps.filter((s) => s.status === "completed").length;
  return (
    <div className="tool plan-view">
      <div className="tool-head">
        <span className="tool-label">Plan</span>
        <span className="muted small">
          {done}/{plan.steps.length}
        </span>
      </div>
      {plan.explanation && <p className="muted small">{plan.explanation}</p>}
      <ul>
        {plan.steps.map((s, i) => (
          <li key={i} className={s.status}>
            <span className="mark">{MARK[s.status] ?? "○"}</span> {s.step}
          </li>
        ))}
      </ul>
    </div>
  );
}
