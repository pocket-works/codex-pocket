import { createStore, type Store } from "./store.js";

export interface Computer {
  id: string;
  instanceId: string | null;
  name: string;
  origin: string;
  token: string;
  deviceId: string | null;
  lastRoute: string;
  notifications: boolean;
}

export interface ComputersState {
  computers: Computer[];
  activeId: string | null;
}

export interface PairResult {
  token: string;
  deviceId: string;
  instanceId?: string | null;
  host?: string;
  apiVersion?: number;
}

const KEY = "codex-pocket.computers.v1";
const SCOPED_KEYS = ["codex-pocket.pins", "codex-pocket.lastModel", "codex-pocket.threadReadiness", "codex-pocket.collapsedSections"];

export function scopedKey(key: string, computerId?: string): string {
  return computerId ? `${key}.${computerId}` : key;
}

export function normalizeOrigin(value: string): string {
  const url = new URL(value.trim());
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search) {
    throw new Error("Enter a computer's HTTP or HTTPS address without a path or credentials.");
  }
  return url.origin;
}

export class ComputerRegistry {
  readonly store: Store<ComputersState>;

  constructor(private readonly storage: Storage, private readonly entryOrigin: string) {
    let state: ComputersState = { computers: [], activeId: null };
    const raw = storage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ComputersState;
      if (!Array.isArray(parsed.computers) || parsed.computers.some((c) =>
        !c || !/^[\w-]+$/.test(c.id) || typeof c.token !== "string" || typeof c.name !== "string" ||
        normalizeOrigin(c.origin) !== c.origin || typeof c.lastRoute !== "string")) {
        throw new Error("Saved computer settings are invalid.");
      }
      state = parsed;
      if (!state.computers.some((c) => c.id === state.activeId)) state.activeId = state.computers[0]?.id ?? null;
    } else {
      const token = storage.getItem("codex-pocket.token");
      if (token) {
        const id = crypto.randomUUID();
        const computer: Computer = { id, instanceId: null, name: new URL(entryOrigin).hostname, origin: entryOrigin, token, deviceId: null, lastRoute: "#/", notifications: false };
        const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key));
        const migratedKeys = keys.filter((key) => SCOPED_KEYS.includes(key) || key.startsWith("codex-pocket.draft."));
        for (const key of migratedKeys) storage.setItem(scopedKey(key, id), storage.getItem(key)!);
        state = { computers: [computer], activeId: id };
        storage.setItem(KEY, JSON.stringify(state));
        storage.removeItem("codex-pocket.token");
        for (const key of migratedKeys) storage.removeItem(key);
      }
    }
    this.store = createStore(state);
  }

  get active(): Computer | null {
    const state = this.store.get();
    return state.computers.find((c) => c.id === state.activeId) ?? null;
  }

  private save(state: ComputersState): void {
    this.storage.setItem(KEY, JSON.stringify(state));
    this.store.set(state);
  }

  add(origin: string, pair: PairResult, replaceId?: string): Computer {
    const state = this.store.get();
    const existing = replaceId ? state.computers.find((c) => c.id === replaceId) :
      state.computers.find((c) => pair.instanceId && c.instanceId === pair.instanceId) ??
      state.computers.find((c) => !c.instanceId && c.origin === origin);
    if (replaceId && !existing) throw new Error("Computer no longer exists.");
    if (replaceId && existing?.instanceId && existing.instanceId !== pair.instanceId) {
      throw new Error("This is a different computer. Add it separately.");
    }
    const computer: Computer = {
      id: existing?.id ?? crypto.randomUUID(), instanceId: pair.instanceId ?? null,
      name: existing?.name ?? pair.host ?? new URL(origin).hostname,
      origin, token: pair.token, deviceId: pair.deviceId,
      lastRoute: existing?.lastRoute ?? "#/", notifications: existing?.notifications ?? false,
    };
    this.save({ computers: [...state.computers.filter((c) => c.id !== computer.id), computer], activeId: computer.id });
    return computer;
  }

  select(id: string): void {
    const state = this.store.get();
    if (!state.computers.some((c) => c.id === id)) throw new Error("Computer no longer exists.");
    this.save({ ...state, activeId: id });
  }

  update(id: string, patch: Partial<Pick<Computer, "name" | "lastRoute" | "notifications" | "instanceId" | "deviceId">>): void {
    const state = this.store.get();
    this.save({ ...state, computers: state.computers.map((c) => c.id === id ? { ...c, ...patch } : c) });
  }

  remove(id: string): void {
    const state = this.store.get();
    const computers = state.computers.filter((c) => c.id !== id);
    this.save({ computers, activeId: state.activeId === id ? computers[0]?.id ?? null : state.activeId });
    const keys = Array.from({ length: this.storage.length }, (_, i) => this.storage.key(i));
    for (const key of keys) if (key?.startsWith("codex-pocket.") && key.endsWith(`.${id}`)) this.storage.removeItem(key);
  }
}

let registry: ComputerRegistry | null = null;
export function getComputerRegistry(): ComputerRegistry {
  return registry ??= new ComputerRegistry(localStorage, location.origin);
}
