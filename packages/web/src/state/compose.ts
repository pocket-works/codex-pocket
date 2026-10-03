import type { v2 } from "@codex-pocket/protocol";

export interface DraftImage {
  id: string;
  /** Path on the Mac after upload. */
  path: string;
  previewUrl: string;
}

export interface Mention {
  name: string;
  path: string;
}

export interface DraftFile {
  id: string;
  name: string;
  /** Path on the Mac after upload. */
  path: string;
}

export interface Draft {
  text: string;
  images: DraftImage[];
  files: DraftFile[];
  /** Files picked from the @ popover; only those still written in `text` are sent. */
  mentions: Mention[];
  skill: { name: string; path: string } | null;
}

export const emptyDraft: Draft = { text: "", images: [], files: [], mentions: [], skill: null };

const encoder = new TextEncoder();

function byteLength(s: string): number {
  return encoder.encode(s).length;
}

// Turns the composer draft into the protocol's input list. Text elements
// carry byte ranges (UTF-8) of the `@name` tokens so other clients can
// render them as pills.
export function buildUserInput(draft: Draft): v2.UserInput[] {
  const out: v2.UserInput[] = [];
  if (draft.skill) out.push({ type: "skill", name: draft.skill.name, path: draft.skill.path });

  // The protocol has no document input; give Codex the uploaded paths to read.
  const attachments = draft.files.map((file) => `${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`).join("\n");
  const text = attachments ? `${draft.text}${draft.text ? "\n\n" : ""}Attached files:\n${attachments}` : draft.text;
  const elements: v2.TextElement[] = [];
  const present: Mention[] = [];
  for (const m of draft.mentions) {
    const token = `@${m.name}`;
    const idx = draft.text.indexOf(token);
    if (idx < 0) continue;
    const start = byteLength(text.slice(0, idx));
    elements.push({ byteRange: { start, end: start + byteLength(token) }, placeholder: m.name });
    present.push(m);
  }
  elements.sort((a, b) => a.byteRange.start - b.byteRange.start);
  if (text.trim()) out.push({ type: "text", text, text_elements: elements });
  for (const m of present) out.push({ type: "mention", name: m.name, path: m.path });
  for (const img of draft.images) out.push({ type: "localImage", path: img.path });
  return out;
}

/** The `@query` token under the caret, if any. Rejects `@` glued to a word (emails). */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, query };
}

/**
 * Why the draft cannot be sent right now, or null. Mirrors the official
 * app's submit blockers, shown under the composer instead of a generic
 * error after the fact.
 */
export function sendBlocker(args: { draft: Draft; uploading: number; model: string; models: Pick<v2.Model, "model" | "inputModalities">[] }): string | null {
  if (args.uploading > 0) return "Files uploading…";
  if (args.draft.images.length > 0) {
    const m = args.models.find((x) => x.model === args.model);
    if (m && !m.inputModalities.includes("image")) return "Remove images or switch models to send this message";
  }
  return null;
}
