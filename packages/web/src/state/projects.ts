import type { v2 } from "@codex-pocket/protocol";
import type { ThreadSummary } from "./thread-list.js";

/**
 * A project as the app-server owns it. This is the same list the desktop app
 * shows, so deleting a project there removes it here too — the phone never
 * invents projects from folder names.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  /** Folders that belong to the project; a project may own several. */
  roots: string[];
  /** Manual sidebar order from the desktop; lower comes first. */
  position: number;
}

export interface ProjectGroup {
  project: ProjectSummary;
  threads: ThreadSummary[];
  /** Recency of the newest thread; 0 when the project has none loaded. */
  updatedAt: number;
}

export function summarizeProject(p: v2.Project): ProjectSummary {
  return { id: p.id, name: p.name, roots: p.roots.map((r) => r.path), position: p.position };
}

export function summarizeProjects(list: v2.Project[]): ProjectSummary[] {
  return list.map(summarizeProject);
}

function normalize(path: string): string {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return trimmed || "/";
}

function basename(path: string): string {
  return normalize(path).split("/").filter(Boolean).pop() ?? path;
}

// Desktop-app worktrees live at ~/.codex/worktrees/<id>/<repo>. The PWA cannot
// read their .git file, so they are folded into the project with the same name.
export function isWorktree(cwd: string): boolean {
  return /\/\.codex\/worktrees\/[^/]+\/[^/]+$/.test(cwd);
}

export function isScratchThread(t: Pick<ThreadSummary, "cwd">): boolean {
  return /\/Documents\/Codex\/[^/]+\/[^/]+/.test(t.cwd);
}

/**
 * Which project a folder belongs to: an explicit assignment wins, then the
 * root that the folder *is*, then the same-named folder for a worktree
 * checkout.
 *
 * Roots match exactly, never as a prefix: the desktop assigns a thread to a
 * project explicitly, so a repo sitting inside a project's folder (or the
 * home-directory root) is its own thing. Prefix matching here would swallow
 * every scratch dir under the home root and resurrect projects the user just
 * deleted.
 */
export function projectForCwd(cwd: string, projects: ProjectSummary[], explicitId: string | null = null): ProjectSummary | null {
  if (explicitId) {
    const assigned = projects.find((p) => p.id === explicitId);
    if (assigned) return assigned;
  }
  const target = normalize(cwd);
  for (const p of projects) {
    for (const root of p.roots) {
      if (normalize(root) === target) return p;
    }
  }
  if (isWorktree(cwd)) {
    const name = basename(cwd);
    return projects.find((p) => p.roots.some((r) => basename(r) === name)) ?? null;
  }
  return null;
}

/**
 * Buckets threads by the app-server's projects. Threads that belong to no
 * project come back as `ungrouped` so the UI can list them as plain chats
 * instead of fabricating a project out of their folder name.
 */
export function groupByProject(threads: ThreadSummary[], projects: ProjectSummary[]): { groups: ProjectGroup[]; ungrouped: ThreadSummary[] } {
  const byId = new Map<string, ProjectGroup>();
  for (const p of projects) byId.set(p.id, { project: p, threads: [], updatedAt: 0 });
  const ungrouped: ThreadSummary[] = [];
  for (const t of threads) {
    const project = projectForCwd(t.cwd, projects, t.projectId);
    const group = project ? byId.get(project.id) : undefined;
    if (!group) {
      ungrouped.push(t);
      continue;
    }
    group.threads.push(t);
    group.updatedAt = Math.max(group.updatedAt, t.updatedAt);
  }
  const groups = [...byId.values()];
  for (const g of groups) g.threads.sort((a, b) => b.updatedAt - a.updatedAt);
  // Busy projects first, then the desktop's own order so empty ones stay put.
  groups.sort((a, b) => b.updatedAt - a.updatedAt || a.project.position - b.project.position);
  return { groups, ungrouped };
}
