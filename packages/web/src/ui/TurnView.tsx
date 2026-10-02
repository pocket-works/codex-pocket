import { memo, useEffect, useMemo, useState } from "react";
import type { Session } from "../state/session.js";
import type { ThreadItem, ThreadViewState } from "../state/thread-reducer.js";
import { changeTotals, formatDuration, groupTurns, isToolItem, sameGroup, splitMcpContent, stripDirectives, summarizeTools, tailLines, toolFailed, toolLabel, turnDurationMs, type FileChange, type TurnGroup } from "../state/turns.js";
import { diffStats } from "../state/diff.js";
import { FileDiff } from "./DiffView.js";
import { ChevronIcon } from "./icons.js";
import { handleCodeCopy, renderMarkdown } from "./markdown.js";
import { friendlyError } from "../state/errors.js";
import { navigate } from "./route.js";
import { useLocalImage, useUploadedImage } from "./uploaded-image.js";
import type { v2 } from "@codex-pocket/protocol";

// Transcript laid out like the official app: user bubble, a collapsible
// "Worked for …" section (reasoning, tools, interim notes), then the final
// answer in plain text with copy / rate / fork actions underneath.

export function Transcript({ session, view, cwd, readOnly = false }: { session: Session; view: ThreadViewState; cwd: string; readOnly?: boolean }) {
  const groups = groupTurns(view);
  return (
    <>
      {groups.map((g, i) => (
        // Editing reverts the whole turn, so a steered message (a later part
        // of its turn) is not offered as the one to edit.
        <TurnBlock key={g.key} group={g} session={session} cwd={cwd} latest={i === groups.length - 1} editable={!readOnly && i === groups.length - 1 && view.activeTurnId === null && g.meta !== null && g.key === g.turnId} progress={view.toolProgress} />
      ))}
      {view.pending.map((m) => (
        <UserBubble key={m.id} content={m.input} pending />
      ))}
    </>
  );
}

// Every delta re-renders the transcript; turns whose items did not change
// are skipped wholesale so a long thread stays smooth while the last one
// streams.
const TurnBlock = memo(TurnBlockImpl, (a, b) => a.session === b.session && a.cwd === b.cwd && a.latest === b.latest && a.editable === b.editable && a.progress === b.progress && sameGroup(a.group, b.group));

function TurnBlockImpl({ group, session, cwd, latest, editable, progress }: { group: TurnGroup; session: Session; cwd: string; latest: boolean; editable: boolean; progress: Record<string, string> }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (latest || group.inProgress);
  const hasWork = group.work.length > 0;
  return (
    <section className="turn">
      {group.userMessages.map((m, i) => m.type === "userMessage" && <UserBubble key={m.id} content={m.content} onEdit={editable && i === 0 ? () => session.beginEdit(group.turnId, plainText(m.content)) : undefined} />)}
      {(hasWork || group.inProgress) && (
        <>
          <WorkHeader group={group} expanded={expanded} onToggle={() => setOpen(!expanded)} />
          {expanded && <WorkSection items={group.work} session={session} cwd={cwd} progress={progress} live={group.inProgress} />}
          {group.final && <hr className="turn-sep" />}
        </>
      )}
      {group.final && <FinalAnswer text={group.final.text} group={group} session={session} cwd={cwd} />}
      {!group.final && !group.inProgress && group.meta?.status !== "inProgress" && group.fileChanges.length > 0 && <ChangesCard changes={group.fileChanges} cwd={cwd} />}
    </section>
  );
}

// Text first, attached images underneath; a pending bubble is one the phone
// sent that Codex has not echoed back yet.
/** The text a user message was typed as, for editing it. */
function plainText(content: v2.UserInput[]): string {
  return content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

function UserBubble({ content, pending, onEdit }: { content: v2.UserInput[]; pending?: boolean; onEdit?: () => void }) {
  // A mention's `@name` is already written in the text part; the skill is
  // shown as the /command it was typed as.
  const text = content
    .map((c) => (c.type === "text" ? c.text : c.type === "image" || c.type === "localImage" || c.type === "mention" || c.type === "skill" ? "" : `[${c.type}]`))
    .join("");
  const skills = content.filter((c) => c.type === "skill");
  const images = content.filter((c) => c.type === "image" || c.type === "localImage");
  return (
    <div className={`msg user ${pending ? "pending" : ""}`}>
      {skills.map((c, i) => c.type === "skill" && <span key={i} className="msg-skill">/{c.name}</span>)}
      {text}
      {images.length > 0 && (
        <div className="msg-images">
          {images.map((c, i) => (c.type === "localImage" ? <UserImage key={i} path={c.path} /> : c.type === "image" ? <img key={i} src={c.url} alt="" /> : null))}
        </div>
      )}
      {onEdit && (
        <button type="button" className="msg-edit" aria-label="Edit this message" onClick={onEdit}>
          Edit
        </button>
      )}
    </div>
  );
}

function UserImage({ path }: { path: string }) {
  const url = useUploadedImage(path);
  // An image attached from the desktop app lives somewhere on the Mac the
  // host will not serve; name it rather than show nothing.
  return url ? <img src={url} alt="" /> : <span className="msg-image-name">{path.slice(path.lastIndexOf("/") + 1)}</span>;
}

function WorkHeader({ group, expanded, onToggle }: { group: TurnGroup; expanded: boolean; onToggle: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!group.inProgress) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [group.inProgress]);
  const ms = group.continued ? null : turnDurationMs(group.meta, now);
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
// `live` is whether the turn is still running: a command the turn was
// interrupted in the middle of never gets a completion, so its spinner
// would otherwise keep going forever.
function WorkSection({ items, session, cwd, progress, live }: { items: ThreadItem[]; session: Session; cwd: string; progress: Record<string, string>; live: boolean }) {
  const rows: React.ReactNode[] = [];
  let tools: ThreadItem[] = [];
  let thoughts: Extract<ThreadItem, { type: "reasoning" }>[] = [];
  const flush = () => {
    if (thoughts.length > 0) {
      const batch = thoughts;
      thoughts = [];
      rows.push(<Reasoning key={batch[0].id} items={batch} session={session} />);
    }
    if (tools.length > 0) {
      const batch = tools;
      tools = [];
      rows.push(<ToolBatch key={batch[0].id} items={batch} session={session} cwd={cwd} progress={progress} live={live} />);
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
      rows.push(<Markdown key={item.id} className="work-note" text={item.text} session={session} />);
    } else if (item.type === "imageGeneration" && item.savedPath) {
      // Codex saves what it generated; the picture says more than its metadata.
      rows.push(<LocalImage key={item.id} session={session} path={item.savedPath} />);
    } else if (item.type === "contextCompaction") rows.push(<div key={item.id} className="work-muted">Context compacted</div>);
  }
  flush();
  return <div className="work">{rows}</div>;
}

// Collapsed by default; while a call is still running the heading names
// it (the official app's "Editing files" style) instead of the summary.
function ToolBatch({ items, session, cwd, progress, live }: { items: ThreadItem[]; session: Session; cwd: string; progress: Record<string, string>; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (items.length === 1) return <ToolRow item={items[0]} session={session} cwd={cwd} progress={progress[items[0].id]} live={live} />;
  const running = live ? items.find((item) => "status" in item && (item as { status: string }).status === "inProgress") : undefined;
  const failed = items.some(toolFailed);
  return (
    <div className={`tool-batch ${failed ? "failed" : ""}`}>
      <button className="tool-row heading" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <TerminalGlyph />
        <span className="tool-text">{running && !open ? (progress[running.id] ?? toolLabel(running)) : summarizeTools(items)}</span>
        {running && <span className="spinner tool-spinner" role="status" aria-label="Running" title="Running" />}
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && items.map((item) => <ToolRow key={item.id} item={item} session={session} cwd={cwd} progress={progress[item.id]} live={live} />)}
    </div>
  );
}

function ToolRow({ item, session, cwd, progress, live }: { item: ThreadItem; session: Session; cwd: string; progress?: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const status = "status" in item ? (item as { status: string }).status : null;
  const running = live && status === "inProgress";
  const failed = toolFailed(item);
  return (
    <div className={`tool-item ${failed ? "failed" : ""}`}>
      <button className="tool-row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <TerminalGlyph />
        <span className="tool-text">
          {toolLabel(item)}
          {running && progress && <span className="muted"> · {progress}</span>}
        </span>
        {running && <span className="spinner tool-spinner" role="status" aria-label="Running" title="Running" />}
        <span className={`chev ${open ? "down" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && <ToolDetail item={item} session={session} cwd={cwd} />}
    </div>
  );
}

function ToolDetail({ item, session, cwd }: { item: ThreadItem; session: Session; cwd: string }) {
  switch (item.type) {
    case "commandExecution":
      return (
        <div className="tool-detail">
          <pre className="mono">$ {item.command}</pre>
          {item.aggregatedOutput && <CommandOutput text={item.aggregatedOutput} />}
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
    case "mcpToolCall": {
      const { images, rest } = splitMcpContent(item.result);
      return (
        <div className="tool-detail">
          <pre className="mono">{JSON.stringify(item.arguments, null, 2)}</pre>
          {images.map((src, i) => (
            <img key={i} className="tool-image" src={src} alt="" />
          ))}
          {rest && <pre className="mono">{JSON.stringify(rest, null, 2)}</pre>}
          {item.error && <p className="error small">{JSON.stringify(item.error)}</p>}
        </div>
      );
    }
    case "dynamicToolCall":
      return (
        <div className="tool-detail">
          <pre className="mono">{JSON.stringify(item.arguments, null, 2)}</pre>
          {item.contentItems?.map((c, i) =>
            c.type === "inputText" ? (
              <pre key={i} className="mono">{c.text}</pre>
            ) : c.type === "inputImage" ? (
              <img key={i} className="tool-image" src={c.imageUrl} alt="" />
            ) : (
              <pre key={i} className="mono">{JSON.stringify(c, null, 2)}</pre>
            ),
          )}
        </div>
      );
    case "webSearch":
      return <div className="tool-detail">{item.results ? <pre className="mono">{JSON.stringify(item.results, null, 2)}</pre> : <p className="muted small">No results captured.</p>}</div>;
    case "imageView":
      return (
        <div className="tool-detail">
          <LocalImage session={session} path={item.path} />
        </div>
      );
    default:
      return null;
  }
}

// A screenshot Codex took or looked at: it is a file on the Mac, so it is
// read back through Codex rather than served by the host.
function LocalImage({ session, path }: { session: Session; path: string }) {
  const url = useLocalImage(session, path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return url ? <img className="tool-image" src={url} alt={name} /> : <p className="muted small">{name}</p>;
}

// Parsing + sanitising is the expensive part of a re-render; do it once per text.
function Markdown({ text, className, strip, session }: { text: string; className: string; strip?: boolean; session: Session }) {
  const html = useMemo(() => renderMarkdown(strip ? stripDirectives(text) : text), [text, strip]);
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const button = (e.target as Element).closest<HTMLButtonElement>(".file-citation");
    const path = button?.dataset.pdfPath;
    if (!button || !path || button.disabled) {
      void handleCodeCopy(e);
      return;
    }
    button.disabled = true;
    const preview = window.open("", "_blank");
    if (preview) preview.opener = null;
    void session.readPdfFile(path).then((pdf) => {
      const url = URL.createObjectURL(pdf);
      if (preview) preview.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.download = path.slice(path.lastIndexOf("/") + 1);
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
    }).catch((err) => {
      preview?.close();
      session.notify(friendlyError(err));
    }).finally(() => { button.disabled = false; });
  }
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

// A test run or an install can print tens of thousands of lines; laying all
// of that out freezes the phone, and the end is what matters anyway.
const OUTPUT_TAIL_LINES = 200;

function CommandOutput({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const { tail, hidden } = useMemo(() => (all ? { tail: text, hidden: 0 } : tailLines(text, OUTPUT_TAIL_LINES)), [text, all]);
  return (
    <>
      {hidden > 0 && (
        <button className="link-btn small output-more" onClick={() => setAll(true)}>
          Show {hidden.toLocaleString()} earlier line{hidden === 1 ? "" : "s"}
        </button>
      )}
      <pre className="mono">{tail}</pre>
    </>
  );
}

function Reasoning({ items, session }: { items: Extract<ThreadItem, { type: "reasoning" }>[]; session: Session }) {
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
      {open && <Markdown className="tool-detail prose muted" text={texts.join("\n\n---\n\n")} session={session} />}
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
      // Fork through this turn: later turns stay behind. An orphan group
      // (items without a known turn) forks the whole thread.
      const newId = await session.forkThread(threadId, group.meta ? group.turnId : undefined);
      navigate({ name: "thread", id: newId });
    } catch (err) {
      session.notify(friendlyError(err));
    } finally {
      setForking(false);
    }
  }

  return (
    <div className="final">
      <Markdown className="final-text" text={text} strip session={session} />
      {!group.inProgress && group.meta?.status !== "inProgress" && group.fileChanges.length > 0 && <ChangesCard changes={group.fileChanges} cwd={cwd} />}
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
