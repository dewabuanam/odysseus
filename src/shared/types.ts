// Types shared by the main process, preload bridge and renderer.

export type FileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | 'T'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatusCode
  /** Entry is a submodule; submoduleState describes what changed inside it */
  submodule?: boolean
  submoduleState?: string
}

export interface Submodule {
  name: string
  path: string
  url: string
  branch?: string
  /** Commit the submodule is checked out at (or recorded at, if uninitialized) */
  sha: string
  /** ok: matches recorded commit; modified: checked out at a different commit */
  state: 'ok' | 'modified' | 'uninitialized' | 'conflict'
  describe?: string
  /** Nesting level for submodules inside submodules */
  depth?: number
}

export interface PullOptions {
  mode?: 'merge' | 'rebase' | 'ff-only'
  recurseSubmodules?: boolean
}

export interface FetchOptions {
  remote?: string
  tags?: boolean
  recurseSubmodules?: boolean
}

export interface MergeOptions {
  noFf?: boolean
  ffOnly?: boolean
  squash?: boolean
  noVerify?: boolean
}

export interface StashOptions {
  message?: string
  includeUntracked?: boolean
  keepIndex?: boolean
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
  /** Repository (queue) the run belongs to */
  root: string
  title: string
  args: string[]
  time: number
}

/** A command accepted into a repository's queue; it starts once everything before it ends. */
export interface RunQueuedEvent {
  runId: string
  root: string
  title: string
  args: string[]
  time: number
}

export interface HistoryEntry {
  id: string
  root: string
  title: string
  args: string[]
  startedAt: number
  durationMs: number
  exitCode: number | null
  cancelled: boolean
  failedHook?: string
  /** Tail of the combined output */
  output: string
}

export interface LogOptions {
  /** Full ref names hidden from the graph (refs/heads/x, refs/remotes/o/x) */
  hidden?: string[]
  /** Show only history reachable from this ref */
  only?: string
}

export type Keymap = 'default' | 'vscode' | 'jetbrains' | 'resharper'

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
  tags?: boolean
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
  /** Keyboard shortcut preset */
  keymap: Keymap
  /** Shell for the terminal pane; empty = PowerShell on Windows, $SHELL elsewhere */
  terminalShell: string
  /** Programs offered in the terminal pane besides the plain shell, e.g. AI CLIs */
  terminalProfiles: TerminalProfile[]
  /** Profile name the terminal pane starts when it opens ('Shell' for a plain shell) */
  terminalDefault: string
}

/** A program the terminal pane can start, run inside the configured shell. */
export interface TerminalProfile {
  name: string
  /** Command line to run; empty = just the shell */
  command: string
  /** Shell command that installs the program, run first when it isn't on PATH */
  install?: string
}

/** A group of repository tabs, like a browser tab group, with a folder its terminals open in. */
export interface Workspace {
  id: string
  name: string
  /** Index into the lane colors */
  color: number
  /** Folder the workspace's terminals and AI sessions start in */
  folder: string
  /** Repository paths in the group, in tab order */
  repos: string[]
  /** The tab to show when the group is picked */
  lastActive?: string
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
