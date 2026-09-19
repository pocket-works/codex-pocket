import type { v2 } from "@codex-pocket/protocol";

// Follow-ups sent while a turn runs go to the app-server's per-thread queue
// (`thread/queue/*`), the same one the desktop app shows, so a message queued
// from the phone is visible and editable everywhere. Codex starts the next
// queued submission itself when a turn completes; after an interrupt it
// leaves the queue alone until `thread/queue/start`.
//
// ts-rs does not export the request/response types, so they are spelled out
// here (the notification and QueuedSubmission are in the protocol package).

export interface ThreadQueueAddParams {
  threadId: string;
  input: v2.UserInput[];
  clientUserMessageId: string;
}

export interface ThreadQueueAddResponse {
  queuedSubmission: v2.QueuedSubmission;
}

export interface ThreadQueueListParams {
  threadId: string;
  cursor: string | null;
}

export interface ThreadQueueListResponse {
  data: v2.QueuedSubmission[];
  nextCursor: string | null;
}

export interface ThreadQueueDeleteParams {
  threadId: string;
  queuedSubmissionId: string;
}

export interface ThreadQueueDeleteResponse {
  deleted: boolean;
}

export interface ThreadQueueStartParams {
  threadId: string;
  queuedSubmissionId: string;
}

export interface ThreadQueueStartResponse {
  turn: v2.Turn;
}

/** A queued submission as the UI shows it. */
export interface QueuedMessage {
  id: string;
  text: string;
  imageCount: number;
  input: v2.UserInput[];
}

export function summarizeQueued(sub: v2.QueuedSubmission): QueuedMessage {
  let text = "";
  let imageCount = 0;
  for (const part of sub.input) {
    if (part.type === "text") text += part.text;
    else if (part.type === "localImage" || part.type === "image") imageCount++;
    else if (part.type === "skill" && !text) text = `/${part.name}`;
  }
  return { id: sub.id, text: text.trim(), imageCount, input: sub.input };
}

// What the send button does while a turn runs. "steer" folds the message
// into the current turn; "queue" holds it for the next one. Per device, like
// the official app's "Turn on queueing".
export type FollowUpMode = "steer" | "queue";

const KEY = "codex-pocket.followUp";

export function getFollowUpMode(): FollowUpMode {
  try {
    return localStorage.getItem(KEY) === "queue" ? "queue" : "steer";
  } catch {
    return "steer";
  }
}

export function setFollowUpMode(mode: FollowUpMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private mode or blocked storage: the choice just lasts for this session.
  }
}
