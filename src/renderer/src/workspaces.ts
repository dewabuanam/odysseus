import type { RepoSummary, Workspace } from '@shared/types'
import { norm } from './runs'

/** Pure helpers for tab groups (workspaces). App owns the state and persists it. */

export const LANE_COUNT = 8

export const wsOf = (ws: Workspace[], path: string | null | undefined): Workspace | undefined =>
  path ? ws.find((w) => w.repos.some((r) => norm(r) === norm(path))) : undefined

export const newId = () => Math.random().toString(36).slice(2, 10)

/** Next color not used by another group, like browsers do for new tab groups. */
export function nextColor(ws: Workspace[]): number {
  const used = new Set(ws.map((w) => w.color))
  for (let i = 0; i < LANE_COUNT; i++) if (!used.has(i)) return i
  return ws.length % LANE_COUNT
}

/** Removes repositories from every group; groups left empty are dropped. */
export function withoutRepos(ws: Workspace[], paths: string[]): Workspace[] {
  const gone = new Set(paths.map(norm))
  return ws
    .map((w) => ({ ...w, repos: w.repos.filter((r) => !gone.has(norm(r))), lastActive: w.lastActive && gone.has(norm(w.lastActive)) ? undefined : w.lastActive }))
    .filter((w) => w.repos.length > 0)
}

/** Adds repositories to a group (taking them out of any other group). */
export function addRepos(ws: Workspace[], id: string, paths: string[]): Workspace[] {
  const rest = withoutRepos(ws, paths)
  const target = ws.find((w) => w.id === id)
  if (!target) return rest
  const kept = rest.find((w) => w.id === id)
  const merged = { ...target, repos: [...(kept?.repos ?? []), ...paths] }
  return kept ? rest.map((w) => (w.id === id ? merged : w)) : [...rest, merged]
}

/** Keeps only open repositories in groups (after a restart some may be gone). */
export function prune(ws: Workspace[], tabs: RepoSummary[]): Workspace[] {
  const open = new Set(tabs.map((t) => norm(t.path)))
  return withoutRepos(ws, ws.flatMap((w) => w.repos).filter((r) => !open.has(norm(r))))
}

/** Folder that contains every given path: the default folder for a new group's terminals. */
export function commonFolder(paths: string[]): string {
  if (!paths.length) return ''
  const split = paths.map((p) => p.replace(/[\\/]+$/, '').split(/[\\/]/))
  if (split.length === 1) return split[0].slice(0, -1).join('/') || paths[0]
  const out: string[] = []
  for (let i = 0; ; i++) {
    const seg = split[0][i]
    if (seg === undefined || split.some((s) => s[i]?.toLowerCase() !== seg.toLowerCase())) break
    out.push(seg)
  }
  const sep = paths[0].includes('\\') ? '\\' : '/'
  return out.join(sep) || paths[0]
}

export type BarItem = { kind: 'group'; ws: Workspace; open: boolean } | { kind: 'tab'; tab: RepoSummary; ws?: Workspace }

/**
 * Tab row order: a group's chip sits where its first tab is, with all its tabs after it. Only
 * the group holding the active tab is expanded; every other group shows just its chip.
 */
export function barItems(tabs: RepoSummary[], ws: Workspace[], active: string | null): BarItem[] {
  const activeWs = wsOf(ws, active)
  const done = new Set<string>()
  const out: BarItem[] = []
  for (const t of tabs) {
    const w = wsOf(ws, t.path)
    if (!w) {
      out.push({ kind: 'tab', tab: t })
      continue
    }
    if (done.has(w.id)) continue
    done.add(w.id)
    const open = w.id === activeWs?.id
    out.push({ kind: 'group', ws: w, open })
    if (open) for (const m of tabs.filter((x) => wsOf([w], x.path))) out.push({ kind: 'tab', tab: m, ws: w })
  }
  return out
}
