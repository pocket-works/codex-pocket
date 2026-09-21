// The PWA on a phone can stay open for days, running whatever bundle it
// loaded, while the host has long since been rebuilt. Vite names the entry
// bundle by its content hash, so comparing the name in a fresh copy of
// index.html with the one this page loaded says whether a reload would
// bring anything new.

const ENTRY = /\/assets\/index-[\w-]+\.js/;

/** The entry bundle this page runs, or null in dev where there is no hash. */
export function loadedEntry(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return script ? new URL(script.src, location.href).pathname : null;
}

/** True when `html` (a freshly fetched index.html) names a different entry bundle than `mine`. */
export function entryChanged(html: string, mine: string): boolean {
  const m = ENTRY.exec(html);
  return m !== null && m[0] !== mine;
}

/** Asks the host for the current index.html; false when offline or unchanged. */
export async function checkForUpdate(): Promise<boolean> {
  const mine = loadedEntry();
  if (!mine) return false;
  try {
    const res = await fetch("/", { cache: "no-store", headers: { Accept: "text/html" } });
    if (!res.ok) return false;
    return entryChanged(await res.text(), mine);
  } catch {
    return false;
  }
}
