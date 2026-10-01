import { afterEach, describe, expect, it, vi } from "vitest";
import { computerRouteHash, localRouteHash, navigate, parseRoute, pocketPanelHash, readPocketPanel, routeComputer, setRouteComputer, workspaceRouteHash } from "../src/ui/route.js";
import { pairingTargetFromScan } from "../src/state/auth.js";

afterEach(() => { setRouteComputer(null); vi.unstubAllGlobals(); });

describe("computer routes", () => {
  it("keeps management navigation separate from the underlying draft or thread", () => {
    const draft = "#/h/mac-a/new?cwd=%2Fproject";
    const panel = pocketPanelHash(draft, { name: "computer", id: "mac-b" });
    expect(parseRoute(panel)).toEqual({ name: "new", cwd: "/project" });
    expect(readPocketPanel(panel)).toEqual({ name: "computer", id: "mac-b" });
    expect(workspaceRouteHash(panel)).toBe("#/new?cwd=%2Fproject");
    expect(pocketPanelHash(panel, null)).toBe(draft);
    expect(pocketPanelHash("#/h/mac-a/t/thread", { name: "about" })).toBe("#/h/mac-a/t/thread?pocket=about");
    expect(readPocketPanel("#/h/mac-a/settings")).toEqual({ name: "computers" });
    expect(workspaceRouteHash("#/settings")).toBe("#/");
  });
  it("preserves computer and thread identity in notification links", () => {
    const hash = computerRouteHash("mac-a", "#/t/thread%2Fid");
    expect(routeComputer(hash)).toBe("mac-a");
    expect(parseRoute(hash)).toEqual({ name: "thread", id: "thread/id" });
    expect(localRouteHash(hash)).toBe("#/t/thread%2Fid");
    expect(parseRoute("#/h/mac-b/new?cwd=%2Fproject")).toEqual({ name: "new", cwd: "/project" });
  });
  it("ignores navigation from a previously selected computer", () => {
    const location = { hash: "#/h/b/" };
    vi.stubGlobal("location", location);
    setRouteComputer("b");
    navigate({ name: "thread", id: "late" }, "a");
    expect(location.hash).toBe("#/h/b/");
    navigate({ name: "thread", id: "current" }, "b");
    expect(location.hash).toBe("#/h/b/t/current");
  });
  it("reads the full target from a scanned QR instead of using the current host", () => {
    expect(pairingTargetFromScan("https://b.ts.net/#pair=ABCD-EFGH", "https://a.ts.net")).toEqual({ origin: "https://b.ts.net", code: "ABCD-EFGH" });
    expect(pairingTargetFromScan("ABCD-EFGH", "https://a.ts.net")).toEqual({ origin: "https://a.ts.net", code: "ABCD-EFGH" });
    expect(pairingTargetFromScan("https://user:pass@b.ts.net/#pair=ABCD-EFGH", "https://a.ts.net")).toBeNull();
    expect(pairingTargetFromScan("https://b.ts.net/#pair=%ZZ", "https://a.ts.net")).toBeNull();
  });
});
