import { useSyncExternalStore } from "react";

// Minimal external store: one immutable state object, selector hooks.
export interface Store<S> {
  get(): S;
  set(updater: S | ((prev: S) => S)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(updater) {
      const next = typeof updater === "function" ? (updater as (prev: S) => S)(state) : updater;
      if (Object.is(next, state)) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<S, T>(store: Store<S>, selector: (s: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
