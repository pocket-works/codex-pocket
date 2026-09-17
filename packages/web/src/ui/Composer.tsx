import { useEffect, useRef, useState } from "react";
import { emptyDraft, mentionQuery, type Draft, type DraftImage } from "../state/compose.js";
import type { FileMatch, Session, Skill } from "../state/session.js";
import { uploadImage } from "../state/uploads.js";

const SEARCH_DEBOUNCE_MS = 150;

interface Popover {
  kind: "files" | "skills";
  /** Index in `text` where the `@` or `/` token starts. */
  start: number;
  query: string;
}

// Message box with image attachments, `@file` completion (fuzzyFileSearch)
// and `/skill` selection. Sends via Session, which decides steer vs start.
export function Composer({ session, disabled, busy }: { session: Session; disabled: boolean; busy: boolean }) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && !sending && uploading === 0 && (draft.text.trim() !== "" || draft.images.length > 0);

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

  function removeImage(img: DraftImage) {
    URL.revokeObjectURL(img.previewUrl);
    setDraft((d) => ({ ...d, images: d.images.filter((i) => i.id !== img.id) }));
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await session.sendMessage(draft);
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

  return (
    <div className="composer">
      {error && <p className="error">{error}</p>}
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
      {popover?.kind === "skills" && visibleSkills.length > 0 && (
        <ul className="popover" role="listbox">
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
            <span className="chip">
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
      <div className="composer-row">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void attach(e.target.files)} />
        <button className="icon-btn" aria-label="Attach image" disabled={disabled} onClick={() => fileRef.current?.click()}>
          {uploading > 0 ? "…" : "+"}
        </button>
        <textarea
          ref={textRef}
          value={draft.text}
          rows={1}
          placeholder={disabled ? "Thread not ready" : busy ? "Add to the running turn…" : "Message Codex…"}
          disabled={disabled}
          onChange={(e) => onTextChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPopover(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button className="primary" onClick={() => void send()} disabled={!canSend} aria-label="Send">
          ↑
        </button>
      </div>
    </div>
  );
}
