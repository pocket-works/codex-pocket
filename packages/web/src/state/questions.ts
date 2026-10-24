import type { v2 } from "@codex-pocket/protocol";
import type { ThreadItem } from "./thread-reducer.js";

const REPLY_OPEN = "<send_user_message_question_reply>";
const REPLY_CLOSE = "</send_user_message_question_reply>";

interface QuestionReply {
  questionItemId: string;
  question: string;
  answer: string;
}

/** Maps a question to the answer written back by the desktop app. */
export type QuestionAnswers = ReadonlyMap<string, string>;

/**
 * The desktop identifies each question with a JSON-encoded path through the
 * original async tool call. The index is the question's position in the card.
 */
export function asyncQuestionItemId(messageId: string, index: number): string {
  return JSON.stringify(["request_user_input_async", messageId, index]);
}

function messageText(content: v2.UserInput[]): string {
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function replyPayload(content: v2.UserInput[]): string | null {
  const match = messageText(content).match(/^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/);
  return match?.[1] ?? null;
}

function parseReplyRows(payload: string): QuestionReply[] {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): QuestionReply[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.questionItemId !== "string" || typeof row.answer !== "string") return [];
    return [{
      questionItemId: row.questionItemId,
      question: typeof row.question === "string" ? row.question : "",
      answer: row.answer,
    }];
  });
}

/** Whether this user message is the transport wrapper for question answers. */
export function isAsyncQuestionReply(content: v2.UserInput[]): boolean {
  return replyPayload(content) !== null;
}

/** Answers already present in the transcript, including reloaded history. */
export function parseAsyncQuestionReplies(items: ThreadItem[]): QuestionAnswers {
  const answers = new Map<string, string>();
  for (const item of items) {
    if (item.type !== "userMessage") continue;
    const payload = replyPayload(item.content);
    if (!payload) continue;
    for (const reply of parseReplyRows(payload)) answers.set(reply.questionItemId, reply.answer);
  }
  return answers;
}

/** The user message understood by the desktop's async question flow. */
export function formatAsyncQuestionReply(
  messageId: string,
  questions: v2.AsyncUserInputQuestion[],
  answers: string[],
): string {
  const rows = questions.map((question, index) => ({
    questionItemId: asyncQuestionItemId(messageId, index),
    question: question.title,
    answer: answers[index] ?? "",
  }));
  return `${REPLY_OPEN}\n${JSON.stringify(rows)}\n${REPLY_CLOSE}\n`;
}
