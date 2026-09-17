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

export interface Draft {
  text: string;
  images: DraftImage[];
  /** Files picked from the @ popover; only those still written in `text` are sent. */
  mentions: Mention[];
  skill: { name: string; path: string } | null;
}

export const emptyDraft: Draft = { text: "", images: [], mentions: [], skill: null };

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

  const text = draft.text;
  const elements: v2.TextElement[] = [];
  const present: Mention[] = [];
  for (const m of draft.mentions) {
    const token = `@${m.name}`;
    const idx = text.indexOf(token);
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
