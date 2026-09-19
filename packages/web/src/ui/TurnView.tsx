import { useEffect, useState } from "react";
import type { Session } from "../state/session.js";
import type { ThreadItem, ThreadViewState } from "../state/thread-reducer.js";
import { changeTotals, formatDuration, groupTurns, isToolItem, stripDirectives, summarizeTools, toolFailed, toolLabel, turnDurationMs, type FileChange, type TurnGroup } from "../state/turns.js";
import { diffStats } from "../state/diff.js";
import { FileDiff } from "./DiffView.js";
import { ChevronIcon } from "./icons.js";
import { renderMarkdown } from "./markdown.js";
import { navigate } from "./route.js";

// Transcript laid out like the official app: user bubble, a collapsible
// "Worked for …" section (reasoning, tools, interim notes), then the final
// answer in plain text with copy / rate / fork actions underneath.

export function Transcript({ session, view, cwd }: { session: Session; view: ThreadViewState; cwd: string }) {
  const groups = groupTurns(view);
  return (
    <>
      {groups.map((g, i) => (
        <TurnBlock key={g.turnId} group={g} session={session} cwd={cwd} latest={i === groups.length - 1} />
      ))}
    </>
  );
}

function TurnBlock({ group, session, cwd, latest }: { group: TurnGroup; session: Session; cwd: string; latest: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (latest || group.inProgress);
  const hasWork = group.work.length > 0;
  return (
    <section className="turn">
      {group.userMessages.map((m) => (
        <UserBubble key={m.id} item={m} />
      ))}
      {(hasWork || group.inProgress) && (
        <>
          <WorkHeader group={group} expanded={expanded} onToggle={() => setOpen(!expanded)} />
          {expanded && <WorkSection items={group.work} cwd={cwd} />}
          {group.final && <hr className="turn-sep" />}
        </>
      )}
      {group.final && <FinalAnswer text={group.final.text} group={group} session={session} cwd={cwd} />}
      {!group.final && group.fileChanges.length > 0 && <ChangesCard changes={group.fileChanges} cwd={cwd} />}
    </section>
  );
}

function UserBubble({ item }: { item: ThreadItem }) {
  if (item.type !== "userMessage") return null;
  const text = item.content
    .map((c) => (c.type === "text" ? c.text : c.type === "mention" || c.type === "skill" ? `@${c.name}` : c.type === "image" || c.type === "localImage" ? "[image]" : `[${c.type}]`))
    .join("");
  return <div className="msg user">{text}</div>;
}

function WorkHeader({ group, expanded, onToggle }: { group: TurnGroup; expanded: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!group.inProgress) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [group.inProgress]);
  const ms = turnDurationMs(group.meta, now);
  const label = group.inProgress ? `Working${ms !== null ? ` · ${formatDuration(ms)}` : "…"}` : ms !== null ? `Worked for ${formatDuration(ms)}` : "Work";
  return (
    <button className={`work-header ${group.inProgress ? "live" : ""}`} onClick={onToggle} aria-expanded={expanded}>
      <span>{label}</span>
      <span className={`chev ${expanded ? "down" : ""}`}>
        <ChevronIcon />
      </span>
    </button>
  );
}

// Consecutive tool calls collapse under one activity summary ("Read 3
// files · Ran a command"), as in the official app. Reasoning between tool
// calls does not split the batch; it is folded into one "Thinking" row
// ahead of it.
function WorkSection({ items, cwd }: { items: ThreadItem[]; cwd: string }) {
  const rows: React.ReactNode[] = [];
  let tools: ThreadItem[] = [];
  let thoughts: Extract<ThreadItem, { type: "reasoning" }>[] = [];
  const flush = () => {
    if (thoughts.length > 0) {
      const batch = thoughts;
      thoughts = [];
      rows.push(<Reasoning key={batch[0].id} items={batch} />);
    }
    if (tools.length > 0) {
      const batch = tools;
      tools = [];
      rows.push(<ToolBatch key={batch[0].id} items={batch} cwd={cwd} />);
    }
  };
  for (const item of items) {
    if (isToolItem(item)) {
      tools.push(item);
      continue;
    }
    if (item.type === "reasoning") {
      thoughts.push(item);
      continue;
    }
    flush();
    if (item.type === "agentMessage" || item.type === "plan") {
      rows.push(<div key={item.id} className="work-note" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }} />);
    } else if (item.type === "contextCompaction") rows.push(<div key={item.id} className="work-muted">Context compacted</div>);
  }
  flush();
  return <div className="work">{rows}</div>;
}

// Collapsed by default; while a call is still running the heading names
// it (the official app's "Editing files" style) instead of the summary.
function ToolBatch({ items, cwd }: { items: ThreadItem[]; cwd: string }) {
  const [open, setOpen] = useState(false);
  if (items.length === 1) return <ToolRow item={items[0]} cwd={cwd} />;
  const running = items.find((item) => "status" in item && (item as { status: string }).status === "inProgress");
  const failed = items.some(toolFailed);
  return (
    <div className={`tool-batch ${failed ? "failed" : ""}`}>
      <button className="tool-row heading" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <TerminalGlyph />
        <span className="tool-text">{running && !open ? toolLabel(running) : summarizeTools(items)}</span>
        {running && <span className="spinner tool-spinner" role="status" aria-label="Running" title="Running" />}
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && items.map((item) => <ToolRow key={item.id} item={item} cwd={cwd} />)}
    </div>
  );
}

function ToolRow({ item, cwd }: { item: ThreadItem; cwd: string }) {
  const [open, setOpen] = useState(false);
  const status = "status" in item ? (item as { status: string }).status : null;
  const failed = toolFailed(item);
  return (
    <div className={`tool-item ${failed ? "failed" : ""}`}>
      <button className="tool-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <TerminalGlyph />
        <span className="tool-text">{toolLabel(item)}</span>
        {status === "inProgress" && <span className="spinner tool-spinner" role="status" aria-label="Running" title="Running" />}
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && <ToolDetail item={item} cwd={cwd} />}
    </div>
  );
}

function ToolDetail({ item, cwd }: { item: ThreadItem; cwd: string }) {
  switch (item.type) {
    case "commandExecution":
      return (
        <div className="tool-detail">
          <pre className="mono">$ {item.command}</pre>
          {item.aggregatedOutput && <pre className="mono">{item.aggregatedOutput}</pre>}
          {item.exitCode !== null && item.exitCode !== 0 && <p className="error small">exit {item.exitCode}</p>}
        </div>
      );
    case "fileChange":
      return (
        <div className="tool-detail">
          {item.changes.map((c) => (
            <FileDiff key={c.path} change={c} cwd={cwd} />
          ))}
        </div>
      );
    case "mcpToolCall":
      return (
        <div className="tool-detail">
          <pre className="mono">{JSON.stringify(item.arguments, null, 2)}</pre>
          {item.result && <pre className="mono">{JSON.stringify(item.result, null, 2)}</pre>}
          {item.error && <p className="error small">{JSON.stringify(item.error)}</p>}
        </div>
      );
    case "dynamicToolCall":
      return (
        <div className="tool-detail">
          <pre className="mono">{JSON.stringify(item.arguments, null, 2)}</pre>
          {item.contentItems?.map((c, i) =>
            c.type === "inputText" ? <pre key={i} className="mono">{c.text}</pre> : <pre key={i} className="mono">{JSON.stringify(c, null, 2)}</pre>,
          )}
        </div>
      );
    case "webSearch":
      return <div className="tool-detail">{item.results ? <pre className="mono">{JSON.stringify(item.results, null, 2)}</pre> : <p className="muted small">No results captured.</p>}</div>;
    default:
      return null;
  }
}

function Reasoning({ items }: { items: Extract<ThreadItem, { type: "reasoning" }>[] }) {
  const [open, setOpen] = useState(false);
  const texts = items.map((i) => [...i.summary, ...i.content].filter(Boolean).join("\n\n")).filter(Boolean);
  if (texts.length === 0) return null;
  const first = texts[texts.length - 1].split("\n")[0].replace(/^\*\*|\*\*$/g, "");
  return (
    <div className="tool-item thinking-item">
      <button className="tool-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ThinkGlyph />
        <span className="tool-text muted">{open ? `Thinking${texts.length > 1 ? ` · ${texts.length} steps` : ""}` : first}</span>
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && <div className="tool-detail prose muted" dangerouslySetInnerHTML={{ __html: renderMarkdown(texts.join("\n\n---\n\n")) }} />}
    </div>
  );
}

// Ratings are local only: Codex has no per-message rating API on this
// transport, so thumbs just remember your reaction on this device session.
const ratings = new Map<string, "up" | "down">();

// "1 file changed +4 −0": every edit of the turn, expandable per file.
function ChangesCard({ changes, cwd }: { changes: FileChange[]; cwd: string }) {
  const [open, setOpen] = useState(true);
  const totals = changeTotals(changes, diffStats);
  const files = changes.flatMap((c) => c.changes);
  const failed = changes.some((c) => c.status === "failed" || c.status === "declined");
  return (
    <div className={`changes-card ${failed ? "failed" : ""}`}>
      <button className="changes-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="changes-title">
          {totals.files} file{totals.files === 1 ? "" : "s"} changed
        </span>
        <span className="diff-stats">
          <span className="add">+{totals.added}</span>
          <span className="del">−{totals.removed}</span>
        </span>
        {failed && <span className="pill failed">{changes.find((c) => c.status !== "completed")?.status}</span>}
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && files.map((f, i) => <FileDiff key={`${f.path}-${i}`} change={f} cwd={cwd} />)}
    </div>
  );
}

function FinalAnswer({ text, group, session, cwd }: { text: string; group: TurnGroup; session: Session; cwd: string }) {
  const id = group.final?.id ?? group.turnId;
  const [rating, setRating] = useState<"up" | "down" | null>(ratings.get(id) ?? null);
  const [copied, setCopied] = useState(false);
  const [forking, setForking] = useState(false);
  const when = group.meta?.completedAt ?? group.meta?.startedAt ?? null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard needs a secure context; nothing else to do.
    }
  }

  function rate(r: "up" | "down") {
    const next = rating === r ? null : r;
    if (next) ratings.set(id, next);
    else ratings.delete(id);
    setRating(next);
  }

  async function fork() {
    const threadId = session.store.get().open?.view.threadId;
    if (!threadId || forking) return;
    setForking(true);
    try {
      const newId = await session.forkThread(threadId);
      navigate({ name: "thread", id: newId });
    } finally {
      setForking(false);
    }
  }

  return (
    <div className="final">
      <div className="final-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(stripDirectives(text)) }} />
      {group.fileChanges.length > 0 && <ChangesCard changes={group.fileChanges} cwd={cwd} />}
      {!group.inProgress && (
        <div className="final-actions">
          <button className="act" aria-label="Copy" onClick={() => void copy()}>
            {copied ? <CheckGlyph /> : <CopyGlyph />}
          </button>
          <button className={`act ${rating === "up" ? "on" : ""}`} aria-label="Good response" aria-pressed={rating === "up"} onClick={() => rate("up")}>
            <ThumbGlyph />
          </button>
          <button className={`act ${rating === "down" ? "on" : ""}`} aria-label="Bad response" aria-pressed={rating === "down"} onClick={() => rate("down")}>
            <ThumbGlyph down />
          </button>
          <button className="act" aria-label="Fork thread from here" disabled={forking} onClick={() => void fork()}>
            <ForkGlyph />
          </button>
          {when !== null && <span className="final-time">{new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
        </div>
      )}
    </div>
  );
}

// --- glyphs ---------------------------------------------------------------

function G({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
const TerminalGlyph = () => <G d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 9l3 3-3 3M12 15h5" />;
const ThinkGlyph = () => <G d="M12 3a6 6 0 0 0-4 10.5V16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.5A6 6 0 0 0 12 3zM9 20h6" />;
const CopyGlyph = () => <G d="M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM16 8V5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3" />;
const CheckGlyph = () => <G d="M20 6 9 17l-5-5" />;
const ForkGlyph = () => <G d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V3M12 12v9M9 18l3 3 3-3" />;
function ThumbGlyph({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={down ? { transform: "scaleY(-1)" } : undefined}>
      <path d="M7 10v11H3V10h4zm0 0 4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 19H7" />
    </svg>
  );
}
