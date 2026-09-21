import { useState } from "react";
import type { v2 } from "@codex-pocket/protocol";
import type { Session } from "../state/session.js";
import type { PendingApproval } from "../state/thread-reducer.js";
import { useDialog } from "./dialog.js";

type Params = v2.McpServerElicitationRequestParams;
type Field = v2.McpElicitationPrimitiveSchema;
type Value = string | number | boolean | string[];

// An MCP server asked the user something mid-turn (`mcpServer/elicitation/
// request`). Four shapes: a typed form, a URL to visit, a verification
// challenge, and OpenAI's free-form variant, which is shown as a form when
// its schema looks like one. The turn waits until this is answered.
export function ElicitationSheet({ session, request }: { session: Session; request: PendingApproval }) {
  const p = request.params as unknown as Params;
  const dialog = useDialog(`${p.serverName} asks`);

  const answer = (action: v2.McpServerElicitationAction, content: Record<string, Value> | null = null) =>
    session.answerElicitation(request.id, { action, content, _meta: null });

  return (
    <div className="sheet-backdrop">
      <div ref={dialog.ref} {...dialog.props} className="sheet approval user-input elicitation">
        <h2>{p.serverName}</h2>
        {p.mode === "url" && (
          <>
            <p>{p.message}</p>
            <a className="elicitation-link" href={p.url} target="_blank" rel="noopener noreferrer">
              Open {hostOf(p.url)}
            </a>
            <div className="approval-actions">
              <button className="danger" onClick={() => answer("decline")}>
                Decline
              </button>
              <button className="primary" onClick={() => answer("accept")}>
                Done
              </button>
            </div>
          </>
        )}
        {p.mode === "openai/userVerification" && (
          <>
            <p>{p.description || p.title}</p>
            <pre className="mono">{p.challenge}</pre>
            <div className="approval-actions">
              <button className="danger" onClick={() => answer("decline")}>
                Decline
              </button>
              <button className="primary" onClick={() => answer("accept")}>
                Confirm
              </button>
            </div>
          </>
        )}
        {(p.mode === "form" || p.mode === "openai/form" || p.mode === "openaiForm") && (
          <Form message={p.message} schema={p.requestedSchema as v2.McpElicitationSchema} onDecline={() => answer("decline")} onAccept={(content) => answer("accept", content)} />
        )}
      </div>
    </div>
  );
}

function Form({ message, schema, onDecline, onAccept }: { message: string; schema: v2.McpElicitationSchema; onDecline: () => void; onAccept: (content: Record<string, Value>) => void }) {
  const fields = Object.entries(schema?.properties ?? {}).filter((e): e is [string, Field] => e[1] !== undefined);
  const required = new Set(schema?.required ?? []);
  const [values, setValues] = useState<Record<string, Value>>(() => Object.fromEntries(fields.flatMap(([k, f]) => ("default" in f && f.default !== undefined ? [[k, f.default as Value]] : []))));
  const set = (k: string, v: Value) => setValues((o) => ({ ...o, [k]: v }));
  const missing = fields.some(([k]) => required.has(k) && (values[k] === undefined || values[k] === "" || (Array.isArray(values[k]) && (values[k] as string[]).length === 0)));

  return (
    <>
      <p>{message}</p>
      {fields.length === 0 && <pre className="mono small">{JSON.stringify(schema, null, 2)}</pre>}
      {fields.map(([key, f]) => (
        <fieldset key={key} className="question">
          <legend>
            {f.title ?? key}
            {required.has(key) && <span className="muted"> *</span>}
          </legend>
          {f.description && <p className="muted small">{f.description}</p>}
          <FieldInput name={key} field={f} value={values[key]} onChange={(v) => set(key, v)} />
        </fieldset>
      ))}
      <div className="approval-actions">
        <button className="danger" onClick={onDecline}>
          Decline
        </button>
        <button className="primary" disabled={missing} onClick={() => onAccept(values)}>
          Send
        </button>
      </div>
    </>
  );
}

/** Options of an enum field, with a title for each; empty for non-enum fields. */
function optionsOf(f: Field): { value: string; title: string }[] {
  if ("oneOf" in f) return f.oneOf.map((o) => ({ value: o.const, title: o.title }));
  if ("enum" in f) return f.enum.map((v, i) => ({ value: v, title: ("enumNames" in f && f.enumNames?.[i]) || v }));
  if ("items" in f) {
    if ("anyOf" in f.items) return f.items.anyOf.map((o) => ({ value: o.const, title: o.title }));
    return f.items.enum.map((v) => ({ value: v, title: v }));
  }
  return [];
}

function FieldInput({ name, field, value, onChange }: { name: string; field: Field; value: Value | undefined; onChange: (v: Value) => void }) {
  const options = optionsOf(field);
  if (field.type === "array") {
    const chosen = new Set((value as string[] | undefined) ?? []);
    return (
      <>
        {options.map((o) => (
          <label key={o.value} className="option">
            <input
              type="checkbox"
              checked={chosen.has(o.value)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(o.value);
                else next.delete(o.value);
                onChange([...next]);
              }}
            />
            <span className="option-label">{o.title}</span>
          </label>
        ))}
      </>
    );
  }
  if (options.length > 0) {
    return (
      <>
        {options.map((o) => (
          <label key={o.value} className="option">
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="option-label">{o.title}</span>
          </label>
        ))}
      </>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="option">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span className="option-label">Yes</span>
      </label>
    );
  }
  if (field.type === "number" || field.type === "integer") {
    return (
      <input
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        min={field.minimum}
        max={field.maximum}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }
  const format = "format" in field ? field.format : undefined;
  return (
    <input
      type={format === "email" ? "email" : format === "uri" ? "url" : format === "date" ? "date" : format === "date-time" ? "datetime-local" : "text"}
      value={(value as string | undefined) ?? ""}
      minLength={"minLength" in field ? field.minLength : undefined}
      maxLength={"maxLength" in field ? field.maxLength : undefined}
      placeholder="Your answer"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "link";
  }
}
