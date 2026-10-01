import { useEffect, useState } from "react";

export type Route =
  | { name: "list" }
  | { name: "thread"; id: string }
  | { name: "new"; cwd?: string }
  | { name: "archived" };

export type PocketPanel =
  | { name: "computers" }
  | { name: "computer"; id: string }
  | { name: "pair"; id?: string }
  | { name: "about" };

let currentComputer: string | null = null;

export function setRouteComputer(id: string | null): void { currentComputer = id; }

export function routeComputer(hash: string): string | null {
  const m = hash.match(/^#\/h\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function localRouteHash(hash: string): string {
  return hash.replace(/^#\/h\/[^/?]+/, "#");
}

export function computerRouteHash(id: string, hash: string): string {
  return `#/h/${encodeURIComponent(id)}${localRouteHash(hash).slice(1) || "/"}`;
}

export function workspaceRouteHash(hash: string): string {
  const [path, query = ""] = localRouteHash(hash).split("?");
  const params = new URLSearchParams(query);
  params.delete("pocket");
  params.delete("computer");
  const base = path === "#/settings" ? "#/" : path;
  return `${base}${params.size ? `?${params}` : ""}`;
}

export function readPocketPanel(hash: string): PocketPanel | null {
  const local = localRouteHash(hash);
  if (local.startsWith("#/settings")) return { name: "computers" };
  const params = new URLSearchParams(local.split("?")[1] ?? "");
  const name = params.get("pocket");
  if (name === "computers" || name === "about") return { name };
  const id = params.get("computer");
  if (name === "computer" && id) return { name, id };
  if (name === "pair") return id ? { name, id } : { name };
  return null;
}

export function pocketPanelHash(hash: string, panel: PocketPanel | null): string {
  const [path, query = ""] = workspaceRouteHash(hash).split("?");
  const params = new URLSearchParams(query);
  if (panel) {
    params.set("pocket", panel.name);
    if ("id" in panel && panel.id) params.set("computer", panel.id);
  }
  const local = `${path}${params.size ? `?${params}` : ""}`;
  const id = routeComputer(hash);
  return id ? computerRouteHash(id, local) : local;
}

export function openPocketPanel(panel: PocketPanel, replace = false): void {
  const hash = pocketPanelHash(location.hash, panel);
  if (hash === location.hash) return;
  history[replace ? "replaceState" : "pushState"]({ pocketPanel: true }, "", `/${hash}`);
  window.dispatchEvent(new Event("hashchange"));
}

export function closePocketPanel(): void {
  if (history.state?.pocketPanel && history.length > 1) history.back();
  else {
    history.replaceState(null, "", `/${pocketPanelHash(location.hash, null)}`);
    window.dispatchEvent(new Event("hashchange"));
  }
}

export function parseRoute(hash: string): Route {
  hash = workspaceRouteHash(hash);
  const m = hash.match(/^#\/t\/([^/?]+)/);
  if (m) return { name: "thread", id: decodeURIComponent(m[1]) };
  if (hash.startsWith("#/new")) {
    const cwd = new URLSearchParams(hash.split("?")[1] ?? "").get("cwd");
    return cwd ? { name: "new", cwd } : { name: "new" };
  }
  if (hash.startsWith("#/archived")) return { name: "archived" };
  return { name: "list" };
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case "thread":
      return `#/t/${encodeURIComponent(route.id)}`;
    case "new":
      return route.cwd ? `#/new?cwd=${encodeURIComponent(route.cwd)}` : "#/new";
    case "archived":
      return "#/archived";
    default:
      return "#/";
  }
}

export function navigate(route: Route, computerId?: string): void {
  if (computerId && currentComputer !== computerId) return;
  const local = routeHash(route);
  const hash = currentComputer ? computerRouteHash(currentComputer, local) : local;
  if (location.hash !== hash) location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
