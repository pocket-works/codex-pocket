import type { ReasoningEffort } from "@codex-pocket/protocol";
import { scopedKey } from "./computers.js";

// The model/effort the user last started or switched a thread to. New threads
// pick it up instead of Codex's config default, like the official app; per
// device, so localStorage is the right place.
export interface ModelPick {
  model: string;
  effort: ReasoningEffort | null;
}

const KEY = "codex-pocket.lastModel";

export function getLastModel(computerId?: string): ModelPick | null {
  try {
    const raw = localStorage.getItem(scopedKey(KEY, computerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelPick>;
    if (typeof parsed.model !== "string" || !parsed.model) return null;
    return { model: parsed.model, effort: typeof parsed.effort === "string" ? parsed.effort : null };
  } catch {
    return null;
  }
}

export function setLastModel(pick: ModelPick, computerId?: string): void {
  try {
    localStorage.setItem(scopedKey(KEY, computerId), JSON.stringify(pick));
  } catch {
    // Private mode or blocked storage: the choice just lasts for this session.
  }
}
