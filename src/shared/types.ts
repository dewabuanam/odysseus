// Types shared by the main process, preload bridge and renderer.

export type FileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | 'T'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatusCode
}

export interface WorkingStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  staged: FileChange[]
  unstaged: FileChange[]
  conflicted: FileChange[]
  /** e.g. "merging", "rebasing", "cherry-picking" */
  operation: string | null
}

export interface Branch {
  name: string
  fullRef: string
  remote: boolean
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
  sha: string
}

export interface Tag {
  name: string
  sha: string
}

export interface Stash {
  index: number
  ref: string
  message: string
}

export interface Remote {
  name: string
  url: string
}

export interface RefLabel {
  name: string
  type: 'head' | 'branch' | 'remote' | 'tag'
}

export interface Commit {
  sha: string
  parents: string[]
  author: string
  email: string
  date: number
  subject: string
  refs: RefLabel[]
}

export interface GraphEdge {
  fromLane: number
  toLane: number
  color: number
}

export interface GraphRow {
  lane: number
  color: number
  /** Lines passing through / converging in the upper half of the row */
  top: GraphEdge[]
  /** Lines leaving the node / continuing in the lower half of the row */
  bottom: GraphEdge[]
  width: number
}

export interface CommitDetail extends Commit {
  body: string
  committer: string
  committerDate: number
  files: FileChange[]
}

export interface DiffLine {
  type: 'context' | 'add' | 'del' | 'meta'
  content: string
  oldNo?: number
  newNo?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  binary: boolean
  isNew: boolean
  isDeleted: boolean
  /** Raw header lines (diff --git, index, ---, +++) needed to rebuild patches */
  header: string[]
  hunks: DiffHunk[]
}

// ---------------------------------------------------------------- hooks

export type HookName =
  | 'applypatch-msg'
  | 'pre-applypatch'
  | 'post-applypatch'
  | 'pre-commit'
  | 'pre-merge-commit'
  | 'prepare-commit-msg'
  | 'commit-msg'
  | 'post-commit'
  | 'pre-rebase'
  | 'post-checkout'
  | 'post-merge'
  | 'pre-push'
  | 'post-rewrite'
  | 'pre-auto-gc'
  | 'reference-transaction'
  | 'push-to-checkout'

export type HookManager = 'husky' | 'lefthook' | 'pre-commit' | 'overcommit' | 'simple-git-hooks' | null

export interface HookInfo {
  name: HookName
  path: string
  exists: boolean
  enabled: boolean
  executable: boolean
  /** A `.sample` file exists but no active hook */
  sampleOnly: boolean
  /** First line (shebang) */
  interpreter: string | null
  size: number
}

export interface HooksOverview {
  hooksDir: string
  /** true when core.hooksPath is configured */
  customPath: boolean
  manager: HookManager
  hooks: HookInfo[]
  /** Commands referenced by hooks that could not be found on PATH */
  missingCommands: string[]
}

/** Live event describing a hook's lifecycle, derived from git's trace2 stream. */
export interface HookEvent {
  runId: string
  kind: 'start' | 'exit'
  hook: string
  /** trace2 child id, stable between start and exit */
  childId: number
  exitCode?: number
  durationMs?: number
  time: number
}

/** A chunk of combined stdout/stderr from a running git command. */
export interface OutputEvent {
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

export interface RunStartEvent {
  runId: string
  title: string
  args: string[]
  time: number
}

export interface RunEndEvent {
  runId: string
  exitCode: number | null
  cancelled: boolean
  durationMs: number
  /** Name of the hook that caused the failure, if any */
  failedHook?: string
}

export interface CommandResult {
  ok: boolean
  exitCode: number | null
  cancelled: boolean
  stdout: string
  stderr: string
  failedHook?: string
}

export interface CommitOptions {
  message: string
  amend?: boolean
  noVerify?: boolean
  signoff?: boolean
}

export interface PushOptions {
  remote?: string
  branch?: string
  setUpstream?: boolean
  force?: boolean
  noVerify?: boolean
}

export interface Settings {
  /** Extra directories to prepend to PATH when running git / hooks */
  extraPath: string[]
  /** Import environment from the user's login shell (fixes nvm, asdf, pyenv...) */
  useLoginShellEnv: boolean
  /** Force hooks to emit colors even though they're not attached to a TTY */
  forceColor: boolean
  /** Kill a hook after this many seconds (0 = never) */
  hookTimeoutSec: number
  gitPath: string
  theme: 'dark' | 'light'
}

export interface EnvDiagnostics {
  gitPath: string
  gitVersion: string
  shell: string | null
  loginShellEnvLoaded: boolean
  path: string[]
  tools: Record<string, string | null>
}

export interface RepoSummary {
  path: string
  name: string
}
