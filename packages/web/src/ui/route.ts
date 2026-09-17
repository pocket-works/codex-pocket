import { useEffect, useState } from "react";

export type Route = { name: "list" } | { name: "thread"; id: string } | { name: "new" };

export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/t\/([^/?]+)/);
  if (m) return { name: "thread", id: decodeURIComponent(m[1]) };
  if (hash.startsWith("#/new")) return { name: "new" };
  return { name: "list" };
}

export function navigate(route: Route): void {
  const hash = route.name === "thread" ? `#/t/${encodeURIComponent(route.id)}` : route.name === "new" ? "#/new" : "#/";
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
