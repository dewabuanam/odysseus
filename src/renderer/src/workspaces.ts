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
 * Tab row order: a group's chip sits where its first tab is, with all its tabs after it. Groups
 * stay expanded unless collapsed (by id); the group holding the active tab is always expanded.
 */
export function barItems(tabs: RepoSummary[], ws: Workspace[], active: string | null, collapsed: string[] = []): BarItem[] {
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
    const open = w.id === activeWs?.id || !collapsed.includes(w.id)
    out.push({ kind: 'group', ws: w, open })
    if (open) for (const m of tabs.filter((x) => wsOf([w], x.path))) out.push({ kind: 'tab', tab: m, ws: w })
  }
  return out
}

/** Tabs in the order the tab row shows them: each group's tabs together, where its first tab is. */
export function displayOrder(tabs: RepoSummary[], ws: Workspace[]): RepoSummary[] {
  return barItems(tabs, ws, null, []).flatMap((i) => (i.kind === 'tab' ? [i.tab] : []))
}

/** What a drag in the tab row carries, and where it is dropped. */
export type DragItem = { kind: 'tab'; path: string } | { kind: 'group'; id: string }
export type DropTarget = { kind: 'tab'; path: string; before: boolean } | { kind: 'group'; id: string; before: boolean; open: boolean }

/**
 * Result of a tab row drop: the new tab order and the group the dragged tab ends up in
 * (null: no group; undefined: unchanged, which is always the case for a dragged group).
 * Like browser tab groups, a tab dropped among a group's tabs joins it, and one dropped
 * outside every group leaves its own. A dragged group moves as one block and never lands
 * inside another group.
 */
export function dropInBar(tabs: RepoSummary[], ws: Workspace[], drag: DragItem, target: DropTarget): { tabs: RepoSummary[]; group?: string | null } | null {
  const order = displayOrder(tabs, ws)
  const groupPaths = (id: string) => order.filter((t) => wsOf(ws.filter((w) => w.id === id), t.path)).map((t) => t.path)
  const moving = drag.kind === 'tab' ? [drag.path] : groupPaths(drag.id)
  if (!moving.length) return null

  let anchor: string[]
  let before = target.before
  let group: string | null | undefined
  if (target.kind === 'tab') {
    const tw = wsOf(ws, target.path)
    if (drag.kind === 'group') {
      if (tw?.id === drag.id) return null
      anchor = tw ? groupPaths(tw.id) : [target.path]
    } else {
      if (target.path === drag.path) return null
      anchor = [target.path]
      group = tw?.id ?? null
    }
  } else {
    if (drag.kind === 'group' && target.id === drag.id) return null
    const members = groupPaths(target.id)
    if (drag.kind === 'tab' && !before && target.open) {
      // Just after an open group's chip: the group's first tab.
      anchor = members.slice(0, 1)
      before = true
      group = target.id
    } else {
      anchor = members
      if (drag.kind === 'tab') group = null
    }
  }

  const rest = order.filter((t) => !moving.includes(t.path))
  const at = anchor.filter((p) => !moving.includes(p))
  if (!at.length) {
    // Dropped against itself (a group's only tab beside its own chip): only the group can change.
    return group === undefined ? null : { tabs: order, group }
  }
  const i = before ? rest.findIndex((t) => t.path === at[0]) : rest.findIndex((t) => t.path === at[at.length - 1]) + 1
  const moved = order.filter((t) => moving.includes(t.path))
  return { tabs: [...rest.slice(0, i), ...moved, ...rest.slice(i)], group }
}
