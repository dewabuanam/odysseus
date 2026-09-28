import type {
  Branch,
  CommandResult,
  Commit,
  CommitDetail,
  CommitOptions,
  EnvDiagnostics,
  FileDiff,
  GraphRow,
  HookName,
  HooksOverview,
  PushOptions,
  Remote,
  RepoSummary,
  Settings,
  Stash,
  Submodule,
  FetchOptions,
  MergeOptions,
  PullOptions,
  StashOptions,
  Tag,
  WorkingStatus
} from '@shared/types'

export type DiffSource =
  | { kind: 'unstaged'; path: string; untracked?: boolean }
  | { kind: 'staged'; path: string }
  | { kind: 'commit'; sha: string; path: string }

const call = <T>(method: string, ...args: unknown[]): Promise<T> =>
  window.ody.invoke<T>(method, ...args).catch((e: Error) => {
    // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
    throw new Error(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  })

export const api = {
  getSettings: () => call<Settings>('getSettings'),
  setSettings: (p: Partial<Settings>) => call<Settings>('setSettings', p),
  diagnostics: () => call<EnvDiagnostics>('diagnostics'),
  recentRepos: () => call<RepoSummary[]>('recentRepos'),
  removeRecent: (p: string) => call<void>('removeRecent', p),
  lastRepo: () => call<string | null>('lastRepo'),
  pickRepo: () => call<string | null>('pickRepo'),
  openRepo: (dir: string) => call<RepoSummary>('openRepo', dir),
  initRepo: () => call<RepoSummary | null>('initRepo'),
  cloneRepo: (url: string) => call<RepoSummary | null>('cloneRepo', url),
  openExternal: (p: string) => call<string>('openExternal', p),
  showInFolder: (p: string) => call<void>('showInFolder', p),
  cancelRun: (id: string) => call<boolean>('cancelRun', id),
  platform: () => call<string>('platform'),
  windowMinimize: () => call<void>('windowMinimize'),
  windowToggleMaximize: () => call<void>('windowToggleMaximize'),
  windowClose: () => call<void>('windowClose'),
  windowIsMaximized: () => call<boolean>('windowIsMaximized'),

  status: () => call<WorkingStatus>('status'),
  log: (limit?: number, knownKey?: string) =>
    call<{ key: string; unchanged?: boolean; commits: Commit[]; graph: GraphRow[] }>('log', limit, knownKey),
  commitDetail: (sha: string) => call<CommitDetail>('commitDetail', sha),
  diff: (src: DiffSource, context?: number) => call<FileDiff | null>('diff', src, context),
  branches: () => call<Branch[]>('branches'),
  tags: () => call<Tag[]>('tags'),
  stashes: () => call<Stash[]>('stashes'),
  remotes: () => call<Remote[]>('remotes'),
  lastCommitMessage: () => call<string>('lastCommitMessage'),

  stage: (paths: string[]) => call<void>('stage', paths),
  stageAll: () => call<void>('stageAll'),
  unstage: (paths: string[]) => call<void>('unstage', paths),
  unstageAll: () => call<void>('unstageAll'),
  discard: (paths: string[], untracked: string[]) => call<void>('discard', paths, untracked),
  applyHunk: (file: FileDiff, hunk: number, lines: number[] | null, mode: 'stage' | 'unstage' | 'discard') =>
    call<void>('applyHunk', file, hunk, lines, mode),

  commit: (o: CommitOptions) => call<CommandResult>('commit', o),
  checkout: (ref: string) => call<CommandResult>('checkout', ref),
  checkoutRemote: (ref: string) => call<CommandResult>('checkoutRemote', ref),
  createBranch: (n: string, start?: string, checkout?: boolean) => call<CommandResult>('createBranch', n, start, checkout),
  deleteBranch: (n: string, force?: boolean) => call<CommandResult>('deleteBranch', n, force),
  merge: (ref: string, opts?: MergeOptions) => call<CommandResult>('merge', ref, opts),
  rebase: (onto: string, autostash?: boolean) => call<CommandResult>('rebase', onto, autostash),
  abortOperation: (op: string) => call<CommandResult>('abortOperation', op),
  continueOperation: (op: string) => call<CommandResult>('continueOperation', op),
  cherryPick: (sha: string) => call<CommandResult>('cherryPick', sha),
  revert: (sha: string) => call<CommandResult>('revert', sha),
  reset: (sha: string, mode: 'soft' | 'mixed' | 'hard') => call<CommandResult>('reset', sha, mode),
  createTag: (n: string, sha: string, m?: string) => call<CommandResult>('createTag', n, sha, m),
  deleteTag: (n: string) => call<CommandResult>('deleteTag', n),
  fetch: (o?: FetchOptions) => call<CommandResult>('fetch', o),
  pull: (o?: PullOptions) => call<CommandResult>('pull', o),
  push: (o: PushOptions) => call<CommandResult>('push', o),
  stash: (o?: StashOptions | string) => call<CommandResult>('stash', o),
  stashApply: (ref: string, pop: boolean) => call<CommandResult>('stashApply', ref, pop),
  stashDrop: (ref: string) => call<CommandResult>('stashDrop', ref),

  hooksOverview: () => call<HooksOverview>('hooksOverview'),
  readHook: (n: HookName) => call<string>('readHook', n),
  writeHook: (n: HookName, c: string) => call<void>('writeHook', n, c),
  setHookEnabled: (n: HookName, e: boolean) => call<void>('setHookEnabled', n, e),
  removeHook: (n: HookName) => call<void>('removeHook', n),
  makeHookExecutable: (n: HookName) => call<void>('makeHookExecutable', n),
  runHook: (n: HookName, msg?: string) => call<CommandResult>('runHook', n, msg),

  submodules: () => call<Submodule[]>('submodules'),
  superproject: () => call<string | null>('superproject'),
  submoduleUpdate: (paths?: string[], o?: { init?: boolean; remote?: boolean }) => call<CommandResult>('submoduleUpdate', paths, o),
  submoduleSync: () => call<CommandResult>('submoduleSync'),
  submoduleAdd: (url: string, path: string, branch?: string) => call<CommandResult>('submoduleAdd', url, path, branch),
  submoduleDeinit: (path: string) => call<CommandResult>('submoduleDeinit', path),
  submodulePath: (path: string) => call<string>('submodulePath', path)
}
