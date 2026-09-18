import { useEffect, useState } from "react";

export type Route =
  | { name: "list" }
  | { name: "thread"; id: string }
  | { name: "new"; cwd?: string }
  | { name: "archived" }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/t\/([^/?]+)/);
  if (m) return { name: "thread", id: decodeURIComponent(m[1]) };
  if (hash.startsWith("#/new")) {
    const cwd = new URLSearchParams(hash.split("?")[1] ?? "").get("cwd");
    return cwd ? { name: "new", cwd } : { name: "new" };
  }
  if (hash.startsWith("#/archived")) return { name: "archived" };
  if (hash.startsWith("#/settings")) return { name: "settings" };
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
    case "settings":
      return "#/settings";
    default:
      return "#/";
  }
}

export function navigate(route: Route): void {
  const hash = routeHash(route);
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
