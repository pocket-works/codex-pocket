import { useState } from "react";
import type { v2 } from "@codex-pocket/protocol";
import type { Session } from "../state/session.js";
import type { PendingApproval } from "../state/thread-reducer.js";
import { useDialog } from "./dialog.js";

// Sentinel for the free-text choice; cannot collide with an option label.
const OTHER = "__other__";

// The model asked the user something (`item/tool/requestUserInput`). Each
// question is single-choice; `isOther` adds a free-text option.
export function UserInputSheet({ session, request }: { session: Session; request: PendingApproval }) {
  const { questions } = request.params as unknown as v2.ToolRequestUserInputParams;
  const [choice, setChoice] = useState<Record<string, string>>({});
  const dialog = useDialog("Codex has a question");
  const [text, setText] = useState<Record<string, string>>({});

  function answerFor(q: v2.ToolRequestUserInputQuestion): string | null {
    const picked = choice[q.id];
    if (!q.options || q.options.length === 0 || picked === OTHER) return (text[q.id] ?? "").trim() || null;
    return picked ?? null;
  }

  const complete = questions.every((q) => answerFor(q) !== null);

  function submit() {
    const answers: Record<string, string[]> = {};
    for (const q of questions) answers[q.id] = [answerFor(q) ?? ""];
    session.answerUserInput(request.id, answers);
  }

  return (
    <div className="sheet-backdrop">
      <div ref={dialog.ref} {...dialog.props} className="sheet user-input">
        <h2>Codex has a question</h2>
        {questions.map((q) => (
          <fieldset key={q.id} className="question">
            <legend>{q.header}</legend>
            <p>{q.question}</p>
            {q.options?.map((o) => (
              <label key={o.label} className="option">
                <input type="radio" name={q.id} checked={choice[q.id] === o.label} onChange={() => setChoice({ ...choice, [q.id]: o.label })} />
                <span>
                  <span className="option-label">{o.label}</span>
                  {o.description && <span className="muted small">{o.description}</span>}
                </span>
              </label>
            ))}
            {q.options && q.options.length > 0 && q.isOther && (
              <label className="option">
                <input type="radio" name={q.id} checked={choice[q.id] === OTHER} onChange={() => setChoice({ ...choice, [q.id]: OTHER })} />
                <span className="option-label">Other</span>
              </label>
            )}
            {(!q.options || q.options.length === 0 || choice[q.id] === OTHER) && (
              <input
                type={q.isSecret ? "password" : "text"}
                value={text[q.id] ?? ""}
                placeholder="Your answer"
                onChange={(e) => setText({ ...text, [q.id]: e.target.value })}
              />
            )}
          </fieldset>
        ))}
        <div className="approval-actions">
          <button className="primary" disabled={!complete} onClick={submit}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
