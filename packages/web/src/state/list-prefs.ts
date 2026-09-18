// Per-device presentation preferences for the thread list (not user data,
// so localStorage is fine; the official app keeps these per device too).
export type ListView = "project" | "chronological";

const KEY = "codex-pocket.listView";

export function getListView(): ListView {
  return localStorage.getItem(KEY) === "chronological" ? "chronological" : "project";
}

export function setListView(v: ListView): void {
  localStorage.setItem(KEY, v);
}
