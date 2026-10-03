import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emptyDraft, mentionQuery, sendBlocker, type Draft, type DraftImage } from "../state/compose.js";
import { hasUnconfirmedSend, isEmptyDraft, loadDraft, saveDraft, setUnconfirmedSend } from "../state/drafts.js";
import { Session, type FileMatch, type Skill } from "../state/session.js";
import { isCsv, uploadFile } from "../state/uploads.js";
import { useStore } from "../state/store.js";
import { ContextRing, DictationButton, EffortGauge, FastButton, PermissionsButton, useDictation } from "./ComposerTools.js";
import { ModelSheet } from "./ModelSheet.js";
import { isPinned, togglePin } from "../state/pins.js";
import { navigate } from "./route.js";
import { useUploadedImage } from "./uploaded-image.js";
import { friendlyError } from "../state/errors.js";
import type { HostClient } from "../state/host-client.js";
import { isConnectionError } from "../rpc/client.js";

const SEARCH_DEBOUNCE_MS = 150;

interface Popover {
  kind: "files" | "skills";
  /** Index in `text` where the `@` or `/` token starts. */
  start: number;
  query: string;
}

// Message box with image and CSV attachments, `@file` completion (fuzzyFileSearch)
// and `/skill` selection. Sends via Session, which decides steer vs start,
// unless the caller supplies `onSend` (the new-thread screen starts a thread first).
// The send button has the official app's five states: Send when idle,
// Steer or Queue while a turn runs (per the follow-up preference), Stop
// while a turn runs and the draft is empty, and Resume when the thread is
// idle with a paused queue and nothing typed.
export function Composer({
  session,
  draftKey,
  disabled,
  busy,
  placeholder,
  onSend,
  onStop,
  onResume,
}: {
  session: Session;
  /** Where the unsent text is kept between visits (the thread id, or "new"). */
  draftKey: string;
  disabled: boolean;
  busy: boolean;
  placeholder?: string;
  onSend?: (draft: Draft) => Promise<void>;
  onStop?: () => void;
  /** Present when the queue is paused (idle thread, queued messages). */
  onResume?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(draftKey, session.host?.id));
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(() => hasUnconfirmedSend(draftKey, session.host?.id));
  const [uploading, setUploading] = useState(0);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
  const dictation = useDictation({ session, onText: (text) => setDraft((d) => ({ ...d, text })), onError: setError });

  useEffect(() => { if (!sending) saveDraft(draftKey, draft, session.host?.id); }, [draftKey, draft, sending, session]);

  // "Edit" on the last message: its text replaces the draft until sent or cancelled.
  const editing = useStore(session.store, (s) => s.open?.editing ?? null);
  useEffect(() => {
    if (!editing) return;
    setDraft((d) => ({ ...d, text: editing.text }));
    setFocused(true);
    textRef.current?.focus();
  }, [editing]);

  // Grow the box with its content up to the CSS max-height, whichever way the
  // text got there (typing, paste, dictation, or clearing after send).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "0";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft.text]);

  const project = useStore(session.store, (s) => s.open?.cwd.split("/").filter(Boolean).pop() ?? "this project");
  const followUp = useStore(session.store, (s) => s.followUp);
  const model = useStore(session.store, (s) => (s.open ? Session.effectiveModel(s.open).model : ""));
  const models = useStore(session.store, (s) => s.models);
  const hasDraft = draft.text.trim() !== "" || draft.images.length > 0 || draft.files.length > 0;
  const blocker = sendBlocker({ draft, uploading, model, models });
  const canSend = !disabled && !sending && !unconfirmed && blocker === null && hasDraft;
  const showStop = busy && onStop !== undefined && !hasDraft && !sending;
  const showResume = !busy && onResume !== undefined && !hasDraft && !sending && !disabled;
  const sendLabel = busy ? (followUp === "queue" ? "Queue" : "Steer") : "Send";
  // One-line pill until the box is tapped (official app); the tool row
  // appears with focus and stays while there is something to send or stop.
  const expanded = focused || hasDraft || busy || showResume || uploading > 0 || dictation.phase !== "idle";

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
      if (session.host?.disposed) break;
      const finish = session.beginOperation();
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const csv = isCsv(file);
      const previewUrl = csv ? "" : URL.createObjectURL(file);
      setUploading((n) => n + 1);
      try {
        const path = await uploadFile(file, session.host);
        setDraft((d) => csv
          ? { ...d, files: [...d.files, { id, name: file.name, path }] }
          : { ...d, images: [...d.images, { id, path, previewUrl }] });
      } catch (err) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setError(friendlyError(err));
      } finally {
        finish();
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
    // Sending ends dictation: the mic has nothing left to fill in.
    dictation.discard();
    setSending(true);
    const finish = session.beginOperation();
    setError(null);
    // Clear the box right away so the tap visibly landed (the transcript
    // shows the message as pending meanwhile); put it back if the send fails.
    const sent = draft;
    saveDraft(draftKey, sent, session.host?.id);
    setUnconfirmedSend(draftKey, true, session.host?.id);
    latestDraft.current = emptyDraft;
    setDraft(emptyDraft);
    setPopover(null);
    try {
      await (onSend ? onSend(sent) : session.sendMessage(sent));
      setUnconfirmedSend(draftKey, false, session.host?.id);
      saveDraft(draftKey, latestDraft.current, session.host?.id);
      for (const img of sent.images) URL.revokeObjectURL(img.previewUrl);
    } catch (err) {
      const uncertain = isConnectionError(err) && err.message !== "not connected";
      setUnconfirmedSend(draftKey, uncertain, session.host?.id);
      setUnconfirmed(uncertain);
      const restored = isEmptyDraft(latestDraft.current) ? sent : latestDraft.current;
      saveDraft(draftKey, restored, session.host?.id);
      setDraft(restored);
      setError(friendlyError(err));
    } finally {
      finish();
      setSending(false);
    }
  }

  const visibleSkills = popover?.kind === "skills" ? skills.filter((s) => s.name.toLowerCase().includes(popover.query.toLowerCase())) : [];
  // Built-in slash commands, listed with the skills like the official app
  // (the subset that makes sense on a phone).
  const threadId = useStore(session.store, (s) => s.open?.view.threadId ?? null);
  const threadTitle = useStore(session.store, (s) => s.threads.find((t) => t.id === s.open?.view.threadId)?.title ?? null);
  const cwd = useStore(session.store, (s) => s.open?.cwd ?? "");
  const pinned = threadId !== null && isPinned(threadId, session.host?.id);
  const COMMANDS: { name: string; description: string; run: () => Promise<void>; turn?: boolean }[] = [
    { name: "compact", description: "Compact this chat's context", run: () => session.compactThread(), turn: true },
    { name: "review", description: "Review uncommitted changes", run: () => session.startReview(), turn: true },
    { name: "status", description: "Show chat ID, context usage and rate limits", run: async () => session.info(session.statusLine()) },
    { name: "model", description: "Choose the model and reasoning effort", run: async () => setModelSheet(true) },
    { name: "new", description: "Start a blank chat in the same workspace", run: async () => navigate({ name: "new", cwd }) },
    {
      name: "fork",
      description: "Fork this chat",
      run: async () => {
        if (threadId) navigate({ name: "thread", id: await session.forkThread(threadId) }, session.host?.id);
      },
    },
    {
      name: "rename",
      description: "Rename the current chat",
      run: async () => {
        const name = threadId && window.prompt("Thread name", threadTitle ?? "");
        if (threadId && name) await session.renameThread(threadId, name);
      },
    },
    {
      name: pinned ? "unpin" : "pin",
      description: pinned ? "Remove this chat from the top of the list" : "Keep this chat at the top of the list",
      run: async () => {
        if (!threadId) return;
        togglePin(threadId, session.host?.id);
        session.touchThreads();
      },
    },
    {
      name: "archive",
      description: "Archive the current chat",
      run: async () => {
        if (threadId && window.confirm("Archive this thread?")) {
          await session.archiveThread(threadId);
          navigate({ name: "list" }, session.host?.id);
        }
      },
    },
  ];
  const visibleCommands = popover?.kind === "skills" && !onSend ? COMMANDS.filter((c) => c.name.startsWith(popover.query.toLowerCase())) : [];

  async function runCommand(cmd: (typeof COMMANDS)[number]) {
    setPopover(null);
    setError(null);
    try {
      await cmd.run();
      setDraft((d) => ({ ...d, text: "" }));
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className="composer">
      {modelSheet && <ModelSheet session={session} onClose={() => setModelSheet(false)} />}
      {editing && (
        <p className="muted small composer-hint editing-hint">
          Editing your last message — sending replaces it and its reply.
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              session.cancelEdit();
              setDraft((d) => ({ ...d, text: "" }));
            }}
          >
            Cancel
          </button>
        </p>
      )}
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
                <span className="muted small">{busy && c.turn ? `${c.description} (disabled while a turn runs)` : c.description}</span>
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
      {(draft.skill || draft.images.length > 0 || draft.files.length > 0) && (
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
            <Thumb key={img.id} image={img} host={session.host} onRemove={() => removeImage(img)} />
          ))}
          {draft.files.map((file) => (
            <span className="attachment-chip file-attachment" key={file.id}>
              <span className="file-attachment-name" title={file.name}>{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setDraft((d) => ({ ...d, files: d.files.filter((f) => f.id !== file.id) }))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {unconfirmed && <div className="composer-unconfirmed" role="alert"><span>Send not confirmed. Check the thread before resending.</span><button onClick={() => { setUnconfirmedSend(draftKey, false, session.host?.id); setUnconfirmed(false); }}>Checked</button></div>}
      <div
        className={`composer-box ${expanded ? "" : "collapsed"}`}
        ref={boxRef}
        // Tapping the collapsed pill opens the tool row, but tapping the
        // buttons sitting on it (attach, dictate) must not: the row replaces
        // them mid-gesture, so the button unmounts under the finger and its
        // click never lands — the first press only ever expanded the box.
        onPointerDown={(e) => {
          if (!(e.target instanceof Element) || !e.target.closest("button")) setFocused(true);
        }}
      >
        <input ref={fileRef} type="file" accept="image/*,.csv,text/csv" multiple hidden onChange={(e) => void attach(e.target.files)} />
        {!expanded && (
          <button className="icon-btn" aria-label="Attach file" disabled={disabled} onClick={() => fileRef.current?.click()}>
            +
          </button>
        )}
        <textarea
          ref={textRef}
          value={draft.text}
          rows={1}
          autoComplete="off"
          placeholder={
            disabled
              ? "Thread not ready"
              : dictation.phase !== "idle"
                ? dictation.phase === "starting"
                  ? "Starting the microphone…"
                  : "Listening…"
                : busy
                  ? followUp === "queue"
                    ? "Queue for the next turn…"
                    : "Add to the running turn…"
                  : (placeholder ?? `Work on ${project}`)
          }
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
        {!expanded && <DictationButton dictation={dictation} disabled={disabled} text={draft.text} />}
        {expanded && (
        <div className="composer-tools">
          <button className="icon-btn" aria-label="Attach file" disabled={disabled} onClick={() => fileRef.current?.click()}>
            {uploading > 0 ? "…" : "+"}
          </button>
          <PermissionsButton session={session} disabled={disabled} />
          <span className="spacer" />
          <ContextRing session={session} />
          <FastButton session={session} disabled={disabled} />
          <EffortGauge session={session} disabled={disabled} />
          <DictationButton dictation={dictation} disabled={disabled} text={draft.text} />
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

// A restored draft has no local preview; fetch the upload back from the host.
function Thumb({ image, onRemove, host }: { image: DraftImage; onRemove: () => void; host?: HostClient }) {
  const uploaded = useUploadedImage(image.previewUrl ? null : image.path, host);
  const src = image.previewUrl || uploaded;
  return (
    <span className="thumb">
      {src ? <img src={src} alt="" /> : <span className="thumb-blank" />}
      <button type="button" aria-label="Remove image" onClick={onRemove}>
        ×
      </button>
    </span>
  );
}
