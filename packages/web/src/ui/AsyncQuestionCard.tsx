import { useState } from "react";
import type { v2 } from "@codex-pocket/protocol";
import type { Session } from "../state/session.js";
import { asyncQuestionItemId, type QuestionAnswers } from "../state/questions.js";
import { friendlyError } from "../state/errors.js";

/**
 * An async question is an agent message carrying `questions`. The turn keeps
 * running after it is sent, so this lives in the transcript rather than in a
 * blocking approval sheet.
 */
export function AsyncQuestionCard({ session, messageId, questions, answers, disabled = false }: {
  session: Session;
  messageId: string;
  questions: v2.AsyncUserInputQuestion[];
  answers: QuestionAnswers;
  disabled?: boolean;
}) {
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [text, setText] = useState<Record<number, string>>({});
  const [sentAnswers, setSentAnswers] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const storedAnswers = questions.map((_, index) => answers.get(asyncQuestionItemId(messageId, index)));
  const visibleAnswers = sentAnswers ?? storedAnswers;
  const answered = visibleAnswers.every((answer) => typeof answer === "string" && answer.trim() !== "");
  const complete = answered || disabled;
  const pending = !answered && questions.some((_, index) => answerAt(index) === null);

  function answerAt(index: number): string | null {
    const saved = visibleAnswers[index];
    if (saved !== undefined) return saved;
    const question = questions[index];
    if (question.options && question.options.length > 0) return choice[index] ?? null;
    return (text[index] ?? "").trim() || null;
  }

  async function submit() {
    if (disabled) return;
    const next = questions.map((_, index) => answerAt(index) ?? "");
    if (next.some((answer) => answer.trim() === "") || sending) return;
    setSending(true);
    setFailure(null);
    try {
      await session.answerAsyncQuestion(messageId, questions, next);
      setSentAnswers(next);
    } catch (error) {
      const message = friendlyError(error);
      setFailure(message);
      session.notify(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      className="async-question-card"
      role="group"
      aria-labelledby={`async-question-title-${messageId}`}
      aria-busy={sending}
    >
      <h3 id={`async-question-title-${messageId}`}>Codex has a question</h3>
      {questions.map((question, index) => {
        const saved = visibleAnswers[index];
        return (
          <div className="async-question" key={`${messageId}:${index}`}>
            <p className="async-question-title">{question.title}</p>
            {saved !== undefined ? (
              <p className="async-question-answer"><span>Your answer</span>{saved}</p>
            ) : question.options && question.options.length > 0 ? (
              <div className="async-question-options">
                {question.options.map((option) => (
                  <label className="async-question-option" key={option}>
                    <input
                      type="radio"
                      name={`question-${messageId}-${index}`}
                      checked={choice[index] === option}
                      disabled={sending || complete}
                      onChange={() => setChoice((current) => ({ ...current, [index]: option }))}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            ) : (
              <textarea
                rows={2}
                value={text[index] ?? ""}
                placeholder="Your answer"
                disabled={sending || complete}
                onChange={(event) => setText((current) => ({ ...current, [index]: event.target.value }))}
              />
            )}
          </div>
        );
      })}
      {disabled && !answered && <p className="muted small">This conversation is read-only.</p>}
      {!complete && (
        <>
          {failure && <p className="error small" role="alert">{failure}</p>}
          <button className="primary async-question-send" disabled={sending || pending} onClick={() => void submit()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </>
      )}
    </section>
  );
}
