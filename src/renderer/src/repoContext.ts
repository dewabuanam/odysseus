import { createContext, useContext } from 'react'
import type { Branch, CommandResult, HooksOverview, Remote, Stash, Submodule, Tag, WorkingStatus } from '@shared/types'
import type { Step } from './palette'

export type RefreshScope = 'status' | 'refs' | 'hooks'

export interface RepoCtx {
  root: string
  status: WorkingStatus | null
  branches: Branch[]
  tags: Tag[]
  stashes: Stash[]
  remotes: Remote[]
  hooks: HooksOverview | null
  submodules: Submodule[]
  /** Parent repository path when the open repo is itself a submodule */
  superproject: string | null
  /** Full ref names hidden from the graph */
  hidden: string[]
  /** Graph line color (lane color index) of each loaded commit, by sha */
  laneColors: Map<string, number>
  openRepo(dir: string): void
  refresh(scopes?: RefreshScope[]): Promise<void>
  /** Run a hook-aware command: reports failures, opens the console, refreshes afterwards. */
  exec(fn: () => Promise<CommandResult>, success?: string): Promise<CommandResult>
  /**
   * Run a simple data mutation with error toast + refresh. `optimistic` updates the status
   * immediately so the click feels instant; the real status replaces it moments later.
   */
  mutate(fn: () => Promise<unknown>, scopes?: RefreshScope[], optimistic?: (s: WorkingStatus) => WorkingStatus): Promise<boolean>
  openConsole(): void
  select(sha: string): void
  branchMenu(e: React.MouseEvent, b: Branch): void
  openPalette(step: Step): void
  /** Opens the conflict resolver, on a given file or the first conflicted one. */
  resolveConflicts(path?: string): void
}

export const RepoContext = createContext<RepoCtx | null>(null)

export function useRepo(): RepoCtx {
  const c = useContext(RepoContext)
  if (!c) throw new Error('RepoContext missing')
  return c
}

// ------------------------------------------------------------------ optimistic status helpers

/** Move files between the unstaged and staged lists the way `git add` / `git restore --staged` would. */
export function optimisticStage(paths: string[] | 'all') {
  return (s: WorkingStatus): WorkingStatus => {
    const pick = (f: { path: string }) => paths === 'all' || paths.includes(f.path)
    const moving = s.unstaged.filter(pick)
    const staged = [
      ...s.staged.filter((f) => !moving.some((m) => m.path === f.path)),
      ...moving.map((f) => ({ ...f, status: f.status === '?' ? ('A' as const) : f.status }))
    ]
    return { ...s, unstaged: s.unstaged.filter((f) => !pick(f)), staged: staged.sort((a, b) => a.path.localeCompare(b.path)) }
  }
}

export function optimisticUnstage(paths: string[] | 'all') {
  return (s: WorkingStatus): WorkingStatus => {
    const pick = (f: { path: string }) => paths === 'all' || paths.includes(f.path)
    const moving = s.staged.filter(pick)
    const unstaged = [
      ...s.unstaged.filter((f) => !moving.some((m) => m.path === f.path)),
      ...moving.map((f) => ({ ...f, status: f.status === 'A' ? ('?' as const) : f.status }))
    ]
    return { ...s, staged: s.staged.filter((f) => !pick(f)), unstaged: unstaged.sort((a, b) => a.path.localeCompare(b.path)) }
  }
}

export function optimisticDiscard(paths: string[]) {
  return (s: WorkingStatus): WorkingStatus => ({ ...s, unstaged: s.unstaged.filter((f) => !paths.includes(f.path)) })
}

/** A conflicted file that was just resolved (a side taken, or marked resolved) becomes a staged change. */
export function optimisticResolve(path: string) {
  return (s: WorkingStatus): WorkingStatus => ({
    ...s,
    conflicted: s.conflicted.filter((f) => f.path !== path),
    staged: s.staged.some((f) => f.path === path) ? s.staged : [...s.staged, { path, status: 'M' as const }].sort((a, b) => a.path.localeCompare(b.path))
  })
}
