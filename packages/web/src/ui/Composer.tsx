import { useEffect, useRef, useState } from "react";
import { emptyDraft, mentionQuery, sendBlocker, type Draft, type DraftImage } from "../state/compose.js";
import { Session, type FileMatch, type Skill } from "../state/session.js";
import { uploadImage } from "../state/uploads.js";
import { useStore } from "../state/store.js";
import { ContextRing, DictationButton, EffortGauge, FastButton, PermissionsButton } from "./ComposerTools.js";

const SEARCH_DEBOUNCE_MS = 150;

interface Popover {
  kind: "files" | "skills";
  /** Index in `text` where the `@` or `/` token starts. */
  start: number;
  query: string;
}

// Message box with image attachments, `@file` completion (fuzzyFileSearch)
// and `/skill` selection. Sends via Session, which decides steer vs start,
// unless the caller supplies `onSend` (the new-thread screen starts a thread first).
// The send button has the official app's five states: Send when idle,
// Steer or Queue while a turn runs (per the follow-up preference), Stop
// while a turn runs and the draft is empty, and Resume when the thread is
// idle with a paused queue and nothing typed.
export function Composer({
  session,
  disabled,
  busy,
  placeholder,
  onSend,
  onStop,
  onResume,
}: {
  session: Session;
  disabled: boolean;
  busy: boolean;
  placeholder?: string;
  onSend?: (draft: Draft) => Promise<void>;
  onStop?: () => void;
  /** Present when the queue is paused (idle thread, queued messages). */
  onResume?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  const project = useStore(session.store, (s) => s.open?.cwd.split("/").filter(Boolean).pop() ?? "this project");
  const followUp = useStore(session.store, (s) => s.followUp);
  const model = useStore(session.store, (s) => (s.open ? Session.effectiveModel(s.open).model : ""));
  const models = useStore(session.store, (s) => s.models);
  const hasDraft = draft.text.trim() !== "" || draft.images.length > 0;
  const blocker = sendBlocker({ draft, uploading, model, models });
  const canSend = !disabled && !sending && blocker === null && hasDraft;
  const showStop = busy && onStop !== undefined && !hasDraft && !sending;
  const showResume = !busy && onResume !== undefined && !hasDraft && !sending && !disabled;
  const sendLabel = busy ? (followUp === "queue" ? "Queue" : "Steer") : "Send";
  // One-line pill until the box is tapped (official app); the tool row
  // appears with focus and stays while there is something to send or stop.
  const expanded = focused || hasDraft || busy || showResume || uploading > 0;

  function onBlur() {
    // Taps on the tool row blur the textarea first; keep the row until focus
    // has truly left the box.
    window.setTimeout(() => {
      if (!boxRef.current?.contains(document.activeElement) && !boxRef.current?.matches(":active, :focus-within")) setFocused(false);
    }, 120);
  }

  // Debounced search for the token under the caret.
  useEffect(() => {
    if (!popover) return;
    if (popover.kind === "skills") {
      void session.loadSkills().then(setSkills).catch(() => setSkills([]));
      return;
    }
    const t = window.setTimeout(() => {
      void session.searchFiles(popover.query).then(setFiles).catch(() => setFiles([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [popover?.kind, popover?.query, session]);

  function onTextChange(text: string, caret: number) {
    setDraft((d) => ({ ...d, text }));
    const m = mentionQuery(text, caret);
    if (m) setPopover({ kind: "files", start: m.start, query: m.query });
    else if (/^\/[\w-]*$/.test(text.slice(0, caret)) && !draft.skill) setPopover({ kind: "skills", start: 0, query: text.slice(1, caret) });
    else setPopover(null);
  }

  function pickFile(f: FileMatch) {
    if (!popover) return;
    const token = `@${f.name} `;
    const text = draft.text.slice(0, popover.start) + token + draft.text.slice(popover.start + 1 + popover.query.length);
    setDraft((d) => ({ ...d, text, mentions: d.mentions.some((m) => m.path === f.path) ? d.mentions : [...d.mentions, { name: f.name, path: f.path }] }));
    setPopover(null);
    textRef.current?.focus();
  }

  function pickSkill(s: Skill) {
    if (!popover) return;
    setDraft((d) => ({ ...d, text: d.text.slice(popover.start + 1 + popover.query.length).trimStart(), skill: { name: s.name, path: s.path } }));
    setPopover(null);
    textRef.current?.focus();
  }

  async function attach(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    for (const file of Array.from(list)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      setUploading((n) => n + 1);
      try {
        const path = await uploadImage(file);
        setDraft((d) => ({ ...d, images: [...d.images, { id, path, previewUrl }] }));
      } catch (err) {
        URL.revokeObjectURL(previewUrl);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (images.length === 0) return;
    e.preventDefault();
    const list = new DataTransfer();
    for (const file of images) list.items.add(file);
    void attach(list.files);
  }

  function removeImage(img: DraftImage) {
    URL.revokeObjectURL(img.previewUrl);
    setDraft((d) => ({ ...d, images: d.images.filter((i) => i.id !== img.id) }));
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await (onSend ? onSend(draft) : session.sendMessage(draft));
      for (const img of draft.images) URL.revokeObjectURL(img.previewUrl);
      setDraft(emptyDraft);
      setPopover(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const visibleSkills = popover?.kind === "skills" ? skills.filter((s) => s.name.toLowerCase().includes(popover.query.toLowerCase())) : [];
  // Built-in slash commands, listed with the skills like the official app.
  const COMMANDS: { name: string; description: string; run: () => Promise<void> }[] = [
    { name: "compact", description: "Compact this chat's context", run: () => session.compactThread() },
    { name: "review", description: "Review uncommitted changes", run: () => session.startReview() },
  ];
  const visibleCommands = popover?.kind === "skills" && !onSend ? COMMANDS.filter((c) => c.name.startsWith(popover.query.toLowerCase())) : [];

  async function runCommand(cmd: (typeof COMMANDS)[number]) {
    setPopover(null);
    setError(null);
    try {
      await cmd.run();
      setDraft((d) => ({ ...d, text: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="composer">
      {error && <p className="error">{error}</p>}
      {blocker && hasDraft && <p className="muted small composer-hint">{blocker}</p>}
      {popover?.kind === "files" && files.length > 0 && (
        <ul className="popover" role="listbox">
          {files.slice(0, 8).map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => pickFile(f)}>
                <span className="option-label">{f.name}</span>
                <span className="muted small">{f.relative}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {popover?.kind === "skills" && (visibleSkills.length > 0 || visibleCommands.length > 0) && (
        <ul className="popover" role="listbox">
          {visibleCommands.map((c) => (
            <li key={c.name}>
              <button type="button" onClick={() => void runCommand(c)}>
                <span className="option-label">/{c.name}</span>
                <span className="muted small">{busy ? `${c.description} (disabled while a turn runs)` : c.description}</span>
              </button>
            </li>
          ))}
          {visibleSkills.slice(0, 8).map((s) => (
            <li key={s.path}>
              <button type="button" onClick={() => pickSkill(s)}>
                <span className="option-label">/{s.name}</span>
                <span className="muted small">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(draft.skill || draft.images.length > 0) && (
        <div className="attachments">
          {draft.skill && (
            <span className="attachment-chip">
              /{draft.skill.name}
              <button type="button" aria-label="Remove skill" onClick={() => setDraft((d) => ({ ...d, skill: null }))}>
                ×
              </button>
            </span>
          )}
          {draft.images.map((img) => (
            <span key={img.id} className="thumb">
              <img src={img.previewUrl} alt="" />
              <button type="button" aria-label="Remove image" onClick={() => removeImage(img)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className={`composer-box ${expanded ? "" : "collapsed"}`}
        ref={boxRef}
        onPointerDown={() => setFocused(true)}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void attach(e.target.files)} />
        {!expanded && (
          <button className="icon-btn" aria-label="Attach image" disabled={disabled} onClick={() => fileRef.current?.click()}>
            +
          </button>
        )}
        <textarea
          ref={textRef}
          value={draft.text}
          rows={1}
          autoComplete="off"
          placeholder={disabled ? "Thread not ready" : busy ? (followUp === "queue" ? "Queue for the next turn…" : "Add to the running turn…") : (placeholder ?? `Work on ${project}`)}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={onBlur}
          onChange={(e) => onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPopover(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {!expanded && <DictationButton session={session} disabled={disabled} text={draft.text} onText={(text) => setDraft((d) => ({ ...d, text }))} onError={setError} />}
        {expanded && (
        <div className="composer-tools">
          <button className="icon-btn" aria-label="Attach image" disabled={disabled} onClick={() => fileRef.current?.click()}>
            {uploading > 0 ? "…" : "+"}
          </button>
          <PermissionsButton session={session} disabled={disabled} />
          <span className="spacer" />
          <ContextRing session={session} />
          <FastButton session={session} disabled={disabled} />
          <EffortGauge session={session} disabled={disabled} />
          <DictationButton session={session} disabled={disabled} text={draft.text} onText={(text) => setDraft((d) => ({ ...d, text }))} onError={setError} />
          {showStop ? (
            <button className="primary send-btn stop-btn" onClick={onStop} aria-label="Stop">
              <span className="stop-glyph" aria-hidden="true" />
            </button>
          ) : showResume ? (
            <button className="primary send-btn resume-btn" onClick={onResume} aria-label="Resume queue">
              <span className="resume-glyph" aria-hidden="true" />
            </button>
          ) : (
            <button className={`primary send-btn ${busy && followUp === "queue" ? "queue-btn" : ""}`} onClick={() => void send()} disabled={!canSend} aria-label={sendLabel} title={sendLabel}>
              {busy && followUp === "queue" ? "≡" : "↑"}
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
