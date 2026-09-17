import { useState } from "react";
import type { ThreadItem } from "../state/thread-reducer.js";
import { renderMarkdown } from "./markdown.js";

export function ItemView({ item }: { item: ThreadItem }) {
  switch (item.type) {
    case "userMessage": {
      const text = item.content
        .map((c) => (c.type === "text" ? c.text : c.type === "mention" || c.type === "skill" ? `@${c.name}` : `[${c.type}]`))
        .join("");
      return <div className="msg user">{text}</div>;
    }
    case "agentMessage":
      return <div className="msg agent" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />;
    case "plan":
      return <div className="msg agent plan" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />;
    case "reasoning": {
      const text = [...item.summary, ...item.content].filter(Boolean).join("\n\n");
      return text ? <Collapsible label="Thinking" body={text} muted /> : null;
    }
    case "commandExecution":
      return (
        <Collapsible
          label={`$ ${item.command}`}
          status={item.status}
          body={item.aggregatedOutput ?? ""}
          mono
          trailer={item.exitCode !== null && item.exitCode !== 0 ? `exit ${item.exitCode}` : undefined}
        />
      );
    case "fileChange":
      return (
        <div className="tool">
          <div className="tool-head">
            <span>Edited {item.changes.length} file{item.changes.length === 1 ? "" : "s"}</span>
            <StatusPill status={item.status} />
          </div>
          <ul className="file-list">
            {item.changes.map((c) => (
              <li key={c.path}>
                <span className={`kind ${c.kind.type}`}>{c.kind.type}</span> {c.path}
              </li>
            ))}
          </ul>
        </div>
      );
    case "mcpToolCall":
      return <Collapsible label={`${item.server}.${item.tool}`} status={item.status} body={JSON.stringify(item.arguments, null, 2)} mono />;
    case "dynamicToolCall":
      return <Collapsible label={item.tool} status={item.status} body={JSON.stringify(item.arguments, null, 2)} mono />;
    case "webSearch":
      return <div className="tool muted">Web search</div>;
    case "contextCompaction":
      return <div className="tool muted">Context compacted</div>;
    default:
      return null;
  }
}

function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{status === "inProgress" ? "running" : status}</span>;
}

function Collapsible({
  label,
  body,
  status,
  mono,
  muted,
  trailer,
}: {
  label: string;
  body: string;
  status?: string;
  mono?: boolean;
  muted?: boolean;
  trailer?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool ${muted ? "muted" : ""}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-label">{label}</span>
        {trailer && <span className="pill failed">{trailer}</span>}
        {status && <StatusPill status={status} />}
        <span className="chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && body && <pre className={mono ? "mono" : "prose"}>{body}</pre>}
    </div>
  );
}
