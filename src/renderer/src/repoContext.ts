import { createContext, useContext } from 'react'
import type { Branch, CommandResult, HooksOverview, Remote, Stash, Tag, WorkingStatus } from '@shared/types'

export type RefreshScope = 'status' | 'refs' | 'hooks'

export interface RepoCtx {
  root: string
  status: WorkingStatus | null
  branches: Branch[]
  tags: Tag[]
  stashes: Stash[]
  remotes: Remote[]
  hooks: HooksOverview | null
  refresh(scopes?: RefreshScope[]): Promise<void>
  /** Run a hook-aware command: reports failures, opens the console, refreshes afterwards. */
  exec(fn: () => Promise<CommandResult>, success?: string): Promise<CommandResult>
  /** Run a simple data mutation with error toast + refresh. */
  mutate(fn: () => Promise<unknown>, scopes?: RefreshScope[]): Promise<boolean>
  openConsole(): void
  select(sha: string): void
}

export const RepoContext = createContext<RepoCtx | null>(null)

export function useRepo(): RepoCtx {
  const c = useContext(RepoContext)
  if (!c) throw new Error('RepoContext missing')
  return c
}
