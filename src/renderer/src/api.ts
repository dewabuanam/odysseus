import { createContext, useContext } from 'react'
import type { SearchQuery } from '@shared/search'
import type {
  Branch,
  CommandResult,
  Commit,
  CommitDetail,
  CommitOptions,
  EnvDiagnostics,
  FetchOptions,
  FileDiff,
  GraphRow,
  HistoryEntry,
  HookName,
  HooksOverview,
  LogOptions,
  MergeOptions,
  PullOptions,
  PushOptions,
  Remote,
  RepoSummary,
  Settings,
  Stash,
  StashOptions,
  Submodule,
  Tag,
  TerminalProfile,
  AiState,
  WorkingStatus,
  Workspace
} from '@shared/types'

export type DiffSource =
  | { kind: 'unstaged'; path: string; untracked?: boolean }
  | { kind: 'staged'; path: string }
  | { kind: 'commit'; sha: string; path: string }

// Strip Electron's "Error invoking remote method 'x': Error: " prefix.
const clean = (e: Error): never => {
  throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
}

const call = <T>(method: string, ...args: unknown[]): Promise<T> => window.ody.invoke<T>(method, ...args).catch(clean)

/** Application-level calls (no repository). */
export const api = {
  getSettings: () => call<Settings>('getSettings'),
  setSettings: (p: Partial<Settings>) => call<Settings>('setSettings', p),
  diagnostics: () => call<EnvDiagnostics>('diagnostics'),
  recentRepos: () => call<RepoSummary[]>('recentRepos'),
  removeRecent: (p: string) => call<void>('removeRecent', p),
  getTabs: () => call<{ tabs: RepoSummary[]; active: string | null }>('getTabs'),
  setTabs: (tabs: string[], active: string | null) => call<void>('setTabs', tabs, active),
  getWorkspaces: () => call<Workspace[]>('getWorkspaces'),
  setWorkspaces: (ws: Workspace[]) => call<void>('setWorkspaces', ws),
  pickFolder: (title?: string) => call<string | null>('pickFolder', title),
  scanRepos: (folder: string) => call<string[]>('scanRepos', folder),
  pickRepo: () => call<string | null>('pickRepo'),
  openRepo: (dir: string) => call<RepoSummary>('openRepo', dir),
  closeRepo: (root: string) => call<void>('closeRepo', root),
  initRepo: () => call<RepoSummary | null>('initRepo'),
  cloneRepo: (url: string) => call<RepoSummary | null>('cloneRepo', url),
  history: (root?: string, limit?: number) => call<HistoryEntry[]>('history', root, limit),
  openExternal: (p: string) => call<string>('openExternal', p),
  showInFolder: (p: string) => call<void>('showInFolder', p),
  cancelRun: (id: string) => call<boolean>('cancelRun', id),
  termCreate: (cwd: string, cols: number, rows: number, profile: TerminalProfile) => call<number>('termCreate', cwd, cols, rows, profile),
  termWrite: (id: number, data: string) => call<void>('termWrite', id, data),
  termResize: (id: number, cols: number, rows: number) => call<void>('termResize', id, cols, rows),
  termKill: (id: number) => call<void>('termKill', id),
  setAiStatus: (state: AiState | null, badge: string | null) => call<void>('setAiStatus', state, badge),
  platform: () => call<string>('platform'),
  windowMinimize: () => call<void>('windowMinimize'),
  windowToggleMaximize: () => call<void>('windowToggleMaximize'),
  windowClose: () => call<void>('windowClose'),
  windowIsMaximized: () => call<boolean>('windowIsMaximized')
}

/** Calls bound to one repository (one tab). */
export function repoApi(root: string) {
  const r = <T>(method: string, ...args: unknown[]): Promise<T> => window.ody.repo<T>(root, method, ...args).catch(clean)
  return {
    ...api,
    root,
    status: () => r<WorkingStatus>('status'),
    log: (limit?: number, knownKey?: string, opts?: LogOptions) =>
      r<{ key: string; unchanged?: boolean; commits: Commit[]; graph: GraphRow[] }>('log', limit, knownKey, opts),
    logRef: (ref: string) => r<Commit[]>('logRef', ref),
    search: (q: SearchQuery, limit?: number) => r<Commit[]>('search', q, limit),
    commitDetail: (sha: string) => r<CommitDetail>('commitDetail', sha),
    diff: (src: DiffSource, context?: number) => r<FileDiff | null>('diff', src, context),
    branches: () => r<Branch[]>('branches'),
    tags: () => r<Tag[]>('tags'),
    stashes: () => r<Stash[]>('stashes'),
    remotes: () => r<Remote[]>('remotes'),
    lastCommitMessage: () => r<string>('lastCommitMessage'),
    conflictContent: (path: string) => r<string>('conflictContent', path),
    conflictSides: (path: string) => r<{ ours: boolean; theirs: boolean }>('conflictSides', path),
    getHidden: () => r<string[]>('getHidden'),
    identity: () => r<{ name: string; email: string }>('identity'),
    setIdentity: (name: string, email: string, global: boolean) => r<void>('setIdentity', name, email, global),
    setHidden: (refs: string[]) => r<string[]>('setHidden', refs),

    stage: (paths: string[]) => r<void>('stage', paths),
    stageAll: () => r<void>('stageAll'),
    unstage: (paths: string[]) => r<void>('unstage', paths),
    unstageAll: () => r<void>('unstageAll'),
    discard: (paths: string[], untracked: string[]) => r<void>('discard', paths, untracked),
    applyHunk: (file: FileDiff, hunk: number, lines: number[] | null, mode: 'stage' | 'unstage' | 'discard') =>
      r<void>('applyHunk', file, hunk, lines, mode),
    resolveConflict: (path: string, side: 'ours' | 'theirs') => r<void>('resolveConflict', path, side),
    saveResolution: (path: string, content: string) => r<void>('saveResolution', path, content),

    commit: (o: CommitOptions) => r<CommandResult>('commit', o),
    checkout: (ref: string) => r<CommandResult>('checkout', ref),
    checkoutRemote: (ref: string) => r<CommandResult>('checkoutRemote', ref),
    createBranch: (n: string, start?: string, checkout?: boolean) => r<CommandResult>('createBranch', n, start, checkout),
    deleteBranch: (n: string, force?: boolean) => r<CommandResult>('deleteBranch', n, force),
    renameBranch: (from: string, to: string) => r<CommandResult>('renameBranch', from, to),
    setUpstream: (b: string, u: string) => r<CommandResult>('setUpstream', b, u),
    unsetUpstream: (b: string) => r<CommandResult>('unsetUpstream', b),
    deleteRemoteBranch: (ref: string) => r<CommandResult>('deleteRemoteBranch', ref),
    merge: (ref: string, opts?: MergeOptions) => r<CommandResult>('merge', ref, opts),
    rebase: (onto: string, autostash?: boolean) => r<CommandResult>('rebase', onto, autostash),
    abortOperation: (op: string) => r<CommandResult>('abortOperation', op),
    continueOperation: (op: string) => r<CommandResult>('continueOperation', op),
    cherryPick: (sha: string) => r<CommandResult>('cherryPick', sha),
    revert: (sha: string) => r<CommandResult>('revert', sha),
    reset: (sha: string, mode: 'soft' | 'mixed' | 'hard') => r<CommandResult>('reset', sha, mode),
    rewordCommit: (sha: string, message: string) => r<CommandResult>('rewordCommit', sha, message),
    dropCommit: (sha: string) => r<CommandResult>('dropCommit', sha),
    createTag: (n: string, sha: string, m?: string) => r<CommandResult>('createTag', n, sha, m),
    deleteTag: (n: string) => r<CommandResult>('deleteTag', n),
    fetch: (o?: FetchOptions) => r<CommandResult>('fetch', o),
    pull: (o?: PullOptions) => r<CommandResult>('pull', o),
    push: (o: PushOptions) => r<CommandResult>('push', o),
    stash: (o?: StashOptions | string) => r<CommandResult>('stash', o),
    stashApply: (ref: string, pop: boolean) => r<CommandResult>('stashApply', ref, pop),
    stashDrop: (ref: string) => r<CommandResult>('stashDrop', ref),

    submodules: () => r<Submodule[]>('submodules'),
    superproject: () => r<string | null>('superproject'),
    submoduleUpdate: (paths?: string[], o?: { init?: boolean; remote?: boolean }) => r<CommandResult>('submoduleUpdate', paths, o),
    submoduleSync: () => r<CommandResult>('submoduleSync'),
    submoduleAdd: (url: string, path: string, branch?: string) => r<CommandResult>('submoduleAdd', url, path, branch),
    submoduleDeinit: (path: string) => r<CommandResult>('submoduleDeinit', path),
    submodulePath: (path: string) => r<string>('submodulePath', path),

    hooksOverview: () => r<HooksOverview>('hooksOverview'),
    readHook: (n: HookName) => r<string>('readHook', n),
    writeHook: (n: HookName, c: string) => r<void>('writeHook', n, c),
    setHookEnabled: (n: HookName, e: boolean) => r<void>('setHookEnabled', n, e),
    removeHook: (n: HookName) => r<void>('removeHook', n),
    makeHookExecutable: (n: HookName) => r<void>('makeHookExecutable', n),
    runHook: (n: HookName, msg?: string) => r<CommandResult>('runHook', n, msg)
  }
}

export type RepoApi = ReturnType<typeof repoApi>

export const ApiContext = createContext<RepoApi | null>(null)

/** The API bound to the repository of the tab this component lives in. */
export function useApi(): RepoApi {
  const a = useContext(ApiContext)
  if (!a) throw new Error('ApiContext missing')
  return a
}
