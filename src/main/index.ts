import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { buildEnv, diagnostics, envPath, initEnv } from './env'
import { GitRepo, type DiffSource } from './git/repo'
import { HookService } from './git/hooks'
import { GitRunner } from './git/runner'
import { TerminalService } from './terminal'
import { aiCommands } from './aiCommands'
import { installAiSkills } from './aiSkills'
import { closeEditor, editorOptions, openEditor, pathKind, pickFile, readEditorFile, setEditorDirty, setEditorPath, writeEditorFile } from './editor'
import {
  addHistory,
  addRecent,
  configurePortableMode,
  getHidden,
  getHistory,
  getRecent,
  getSettings,
  getAiPane,
  repoName,
  setAlias,
  getTabs,
  getWorkspaces,
  loadStore,
  removeRecent,
  setHidden,
  setSettings,
  setTabs,
  setAiPane,
  setWorkspaces
} from './store'
import type { SearchQuery } from '@shared/search'
import type {
  FetchOptions,
  FileDiff,
  HookName,
  LogOptions,
  MergeOptions,
  PullOptions,
  RepoSummary,
  Settings,
  AiState,
  StashOptions,
  TerminalProfile,
  AiPaneState,
  Workspace
} from '@shared/types'

let win: BrowserWindow | null = null

configurePortableMode()

const iconPath = join(__dirname, '../../resources/icon.png')

function send(channel: string, payload: unknown): void {
  win?.webContents.send('ody:event', channel, payload)
}

// ------------------------------------------------------------------ runner + history

// Hook output can arrive in thousands of tiny chunks. Coalesce per run and flush at most
// every 40ms so the renderer isn't flooded with IPC messages and re-renders.
const outputBuffers = new Map<string, { stream: 'stdout' | 'stderr'; text: string }>()
let outputTimer: NodeJS.Timeout | null = null
function flushOutput(): void {
  if (outputTimer) clearTimeout(outputTimer)
  outputTimer = null
  for (const [runId, b] of outputBuffers) send('output', { runId, stream: b.stream, text: b.text })
  outputBuffers.clear()
}

/** Everything needed to persist a finished run to the command history. */
const runMeta = new Map<string, { root: string; title: string; args: string[]; startedAt: number; output: string }>()

const runner = new GitRunner({
  settings: getSettings,
  env: (extra) => buildEnv(getSettings(), extra),
  events: {
    runQueued: (e) => {
      runMeta.set(e.runId, { root: e.root, title: e.title, args: e.args, startedAt: e.time, output: '' })
      send('runQueued', e)
    },
    runStart: (e) => {
      const m = runMeta.get(e.runId)
      if (m) m.startedAt = e.time
      send('runStart', e)
    },
    output: (e) => {
      const m = runMeta.get(e.runId)
      if (m && m.output.length < 200_000) m.output += e.text
      const b = outputBuffers.get(e.runId)
      if (b) b.text += e.text
      else outputBuffers.set(e.runId, { stream: e.stream, text: e.text })
      outputTimer ??= setTimeout(flushOutput, 40)
    },
    hook: (e) => {
      flushOutput()
      send('hook', e)
    },
    runEnd: (e) => {
      flushOutput()
      send('runEnd', e)
      const m = runMeta.get(e.runId)
      runMeta.delete(e.runId)
      if (m) {
        addHistory({
          id: e.runId,
          root: m.root,
          title: m.title,
          args: m.args,
          startedAt: m.startedAt,
          durationMs: e.durationMs,
          exitCode: e.exitCode,
          cancelled: e.cancelled,
          failedHook: e.failedHook,
          output: m.output
        })
      }
    }
  }
})

// ------------------------------------------------------------------ terminal pane

// Like hook output, terminal output is batched per session before crossing IPC.
const termBuffers = new Map<number, string>()
let termTimer: NodeJS.Timeout | null = null
function flushTerm(): void {
  termTimer = null
  for (const [id, data] of termBuffers) send('termData', { id, data })
  termBuffers.clear()
}

const terminals = new TerminalService({
  data: (id, data) => {
    termBuffers.set(id, (termBuffers.get(id) ?? '') + data)
    termTimer ??= setTimeout(flushTerm, 8)
  },
  exit: (id, code) => {
    if (termTimer) clearTimeout(termTimer)
    flushTerm()
    send('termExit', { id, code })
  }
})

// ------------------------------------------------------------------ AI status on the taskbar

const AI_COLORS: Record<AiState, [number, number, number]> = { waiting: [217, 58, 50], working: [224, 164, 0], idle: [47, 154, 79] }
const AI_TEXT: Record<AiState, string> = { waiting: 'A session needs your input', working: 'Sessions working', idle: 'Sessions idle' }
let aiStatus: AiState | null = null

/** A filled circle with a light ring, as a 16x16 BGRA bitmap for the taskbar overlay. */
function dotIcon(state: AiState): Electron.NativeImage {
  const size = 32
  const [r, g, b] = AI_COLORS[state]
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const i = (y * size + x) * 4
      const inner = d <= 11.5
      const ring = !inner && d <= 15
      if (!inner && !ring) continue
      const edge = Math.max(0, Math.min(1, 15.5 - d))
      buf[i] = inner ? b : 255
      buf[i + 1] = inner ? g : 255
      buf[i + 2] = inner ? r : 255
      buf[i + 3] = Math.round(255 * edge)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
}

/**
 * Shows the most urgent AI state of every open session on the taskbar button: a red, yellow
 * or green dot on Windows, a dock badge on macOS. Flashes the taskbar when an AI starts
 * waiting for you while Odysseus is in the background.
 */
function setAiStatus(state: AiState | null, badge?: string | null, working = 0): void {
  if (!win) return
  const prev = aiStatus
  aiStatus = state
  notifyAiStatus(prev, state, working)
  if (process.platform === 'win32') {
    const icon = badge ? nativeImage.createFromDataURL(badge) : state ? dotIcon(state) : null
    win.setOverlayIcon(icon && !icon.isEmpty() ? icon : null, state ? AI_TEXT[state] : '')
  }
  else if (process.platform === 'darwin') app.dock?.setBadge(state === 'waiting' ? '!' : state === 'working' ? '•' : '')
  if (state === 'waiting' && prev !== 'waiting' && !win.isFocused()) win.flashFrame(true)
  if (state !== 'waiting') win.flashFrame(false)
}

/**
 * A fullscreen window hides the taskbar and its status dot, so announce the changes worth
 * acting on as notifications instead: an AI waiting for you, or every AI finished.
 */
function notifyAiStatus(prev: AiState | null, state: AiState | null, working: number): void {
  if (!win?.isFullScreen() || !Notification.isSupported() || prev === state) return
  let body: string | null = null
  if (state === 'waiting') body = working > 0 ? `${AI_TEXT.waiting}, ${working} still working` : AI_TEXT.waiting
  else if (prev === 'working' && state === 'idle') body = 'AI finished'
  if (!body) return
  const n = new Notification({ title: 'Odysseus', body, silent: state !== 'waiting', icon: existsSync(iconPath) ? iconPath : undefined })
  n.on('click', () => {
    win?.show()
    win?.focus()
  })
  n.show()
}

// ------------------------------------------------------------------ open repositories (tabs)

/**
 * Classifies file-system changes so the renderer only reloads what changed: worktree and
 * index edits need just `git status`, ref moves need the log, hook edits need the hooks
 * overview. Keeps big repos responsive while you type in your editor.
 */
function classify(f: string): 'status' | 'refs' | 'hooks' | null {
  if (f.includes('node_modules/') || f.endsWith('.lock')) return null
  if (!f.startsWith('.git/')) return 'status'
  if (f.startsWith('.git/objects') || f.startsWith('.git/logs')) return null
  if (f === '.git/index') return 'status'
  if (f.startsWith('.git/hooks')) return 'hooks'
  if (/^\.git\/(HEAD|refs|packed-refs|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|rebase-|FETCH_HEAD|config)/.test(f)) return 'refs'
  // A submodule's HEAD moving changes the parent's submodule state.
  if (/^\.git\/modules\/.+\/(HEAD|refs)/.test(f)) return 'refs'
  return null
}

interface OpenRepo {
  repo: GitRepo
  hooks: HookService
  watcher: FSWatcher | null
  timer: NodeJS.Timeout | null
  scopes: Set<string>
}

const open = new Map<string, OpenRepo>()
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

function register(root: string): OpenRepo {
  const key = norm(root)
  let o = open.get(key)
  if (o) return o
  o = { repo: new GitRepo(root, runner), hooks: new HookService(root, runner, () => envPath(getSettings())), watcher: null, timer: null, scopes: new Set() }
  const entry = o
  try {
    entry.watcher = watch(root, { recursive: true }, (_evt, file) => {
      const scope = classify(String(file ?? '').replace(/\\/g, '/'))
      if (!scope) return
      entry.scopes.add(scope)
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        send('repoChanged', { root, scopes: [...entry.scopes] })
        entry.scopes = new Set()
      }, 250)
    })
  } catch {
    entry.watcher = null
  }
  open.set(key, entry)
  return entry
}

function unregister(root: string): void {
  const key = norm(root)
  const o = open.get(key)
  if (!o) return
  o.watcher?.close()
  if (o.timer) clearTimeout(o.timer)
  open.delete(key)
}

async function openRepo(dir: string): Promise<RepoSummary> {
  const root = await GitRepo.resolveRoot(runner, dir)
  register(root)
  addRecent(root)
  return { path: root, name: repoName(root) }
}

// ------------------------------------------------------------------ IPC: app-level

type Handler = (...args: any[]) => unknown

const appApi: Record<string, Handler> = {
  getSettings: () => getSettings(),
  setSettings: async (patch: Partial<Settings>) => {
    const s = setSettings(patch)
    if ('useLoginShellEnv' in patch) await initEnv(s)
    return s
  },
  diagnostics: () => diagnostics(getSettings()),
  recentRepos: () => getRecent(),
  removeRecent: (p: string) => removeRecent(p),
  getTabs: () => getTabs(),
  setTabs: (tabs: string[], active: string | null) => setTabs(tabs, active),
  getWorkspaces: () => getWorkspaces(),
  setWorkspaces: (ws: Workspace[]) => setWorkspaces(ws),
  getAiPane: () => getAiPane(),
  setAlias: (path: string, alias: string) => setAlias(path, alias),
  setAiPane: (pane: AiPaneState) => setAiPane(pane),
  pickFolder: async (title?: string, create?: boolean) => {
    const r = await dialog.showOpenDialog(win!, { properties: create ? ['openDirectory', 'createDirectory'] : ['openDirectory'], title })
    return r.canceled ? null : r.filePaths[0]
  },
  /** Git repositories in a folder: the folder itself, or the ones directly inside it. */
  scanRepos: (folder: string) => {
    if (existsSync(join(folder, '.git'))) return [folder]
    try {
      return readdirSync(folder, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(folder, d.name, '.git')))
        .map((d) => join(folder, d.name))
    } catch {
      return []
    }
  },
  pickRepo: async (title?: string, defaultPath?: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title, defaultPath: defaultPath || undefined })
    return r.canceled ? null : r.filePaths[0]
  },
  openRepo: (dir: string) => openRepo(dir),
  closeRepo: (root: string) => unregister(root),
  initRepo: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Folder for the new repository' })
    if (r.canceled) return null
    await runner.data(r.filePaths[0], ['init'])
    return openRepo(r.filePaths[0])
  },
  /** Creates the folder when missing and runs `git init` in it. */
  initRepoAt: async (dir: string) => {
    mkdirSync(dir, { recursive: true })
    await runner.data(dir, ['init'])
    return openRepo(dir)
  },
  cloneRepo: async (url: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: 'Clone into…' })
    if (r.canceled) return null
    const name = url.replace(/\.git$/, '').split(/[/:]/).pop() || 'repo'
    const target = join(r.filePaths[0], name)
    const res = await runner.run(r.filePaths[0], ['clone', '--progress', url, target], { title: `Clone ${url}` })
    if (!res.ok) throw new Error(res.stderr.trim() || 'Clone failed')
    return openRepo(target)
  },
  history: (root?: string, limit?: number) => getHistory(root, limit),
  openExternal: (p: string) => shell.openPath(p),
  /** Opens a web link in the browser; only https links are allowed. */
  openUrl: (url: string) => (/^https:\/\//.test(url) ? shell.openExternal(url) : undefined),
  appInfo: () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${process.platform} ${process.getSystemVersion()} ${process.arch}`,
    dataDir: app.getPath('userData')
  }),
  showInFolder: (p: string) => shell.showItemInFolder(p),
  cancelRun: (id: string) => runner.cancel(id),
  termCreate: (cwd: string, cols: number, rows: number, profile: TerminalProfile, sessionId?: string) =>
    terminals.create(cwd, cols, rows, buildEnv(getSettings()), profile, getSettings().terminalShell, sessionId),
  termWrite: (id: number, data: string) => terminals.write(id, data),
  termResize: (id: number, cols: number, rows: number) => terminals.resize(id, cols, rows),
  termKill: (id: number) => terminals.kill(id),
  aiCommands: (command: string, cwd: string) => aiCommands(command, cwd),
  setAiStatus: (state: AiState | null, badge?: string | null, working?: number) => setAiStatus(state, badge, working),
  platform: () => process.platform,
  /** Installed from the Microsoft Store, which keeps it up to date */
  isStore: () => process.windowsStore === true,
  windowMinimize: () => win?.minimize(),
  windowToggleMaximize: () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()),
  windowClose: () => win?.close(),
  windowIsMaximized: () => win?.isMaximized() ?? false
}

// ------------------------------------------------------------------ IPC: per repository

type RepoHandler = (o: OpenRepo, ...args: any[]) => unknown

const repoApi: Record<string, RepoHandler> = {
  // read
  status: ({ repo }) => repo.status(),
  log: ({ repo }, limit?: number, knownKey?: string, opts?: LogOptions) => repo.log(limit, knownKey, opts),
  logRef: ({ repo }, ref: string) => repo.logRef(ref),
  search: ({ repo }, q: SearchQuery, limit?: number) => repo.search(q, limit),
  commitDetail: ({ repo }, sha: string) => repo.commitDetail(sha),
  diff: ({ repo }, src: DiffSource, context?: number) => repo.diff(src, context),
  branches: ({ repo }) => repo.branches(),
  tags: ({ repo }) => repo.tags(),
  stashes: ({ repo }) => repo.stashes(),
  remotes: ({ repo }) => repo.remotes(),
  lastCommitMessage: ({ repo }) => repo.lastCommitMessage(),
  conflictContent: ({ repo }, path: string) => repo.conflictContent(path),
  conflictSides: ({ repo }, path: string) => repo.conflictSides(path),
  getHidden: ({ repo }) => getHidden(repo.root),
  identity: ({ repo }) => repo.identity(),
  setIdentity: ({ repo }, name: string, email: string, global: boolean) => repo.setIdentity(name, email, global),
  setHidden: ({ repo }, refs: string[]) => setHidden(repo.root, refs),

  // index (queued)
  stage: ({ repo }, paths: string[]) => repo.stage(paths),
  stageAll: ({ repo }) => repo.stageAll(),
  unstage: ({ repo }, paths: string[]) => repo.unstage(paths),
  unstageAll: ({ repo }) => repo.unstageAll(),
  discard: ({ repo }, paths: string[], untracked: string[]) => repo.discard(paths, untracked),
  applyHunk: ({ repo }, file: FileDiff, hunk: number, lines: number[] | null, mode: 'stage' | 'unstage' | 'discard') =>
    repo.applyHunk(file, hunk, lines, mode),
  resolveConflict: ({ repo }, path: string, side: 'ours' | 'theirs') => repo.resolveConflict(path, side),
  saveResolution: ({ repo }, path: string, content: string) => repo.saveResolution(path, content),

  // commands (queued, hook-aware, recorded in history)
  commit: ({ repo }, o) => repo.commit(o),
  checkout: ({ repo }, ref: string) => repo.checkout(ref),
  checkoutRemote: ({ repo }, ref: string) => repo.checkoutRemote(ref),
  createBranch: ({ repo }, n: string, s?: string, c?: boolean) => repo.createBranch(n, s, c),
  deleteBranch: ({ repo }, n: string, f?: boolean) => repo.deleteBranch(n, f),
  renameBranch: ({ repo }, from: string, to: string) => repo.renameBranch(from, to),
  setUpstream: ({ repo }, b: string, u: string) => repo.setUpstream(b, u),
  unsetUpstream: ({ repo }, b: string) => repo.unsetUpstream(b),
  deleteRemoteBranch: ({ repo }, ref: string) => repo.deleteRemoteBranch(ref),
  merge: ({ repo }, ref: string, opts?: MergeOptions | boolean) => repo.merge(ref, opts),
  rebase: ({ repo }, onto: string, autostash?: boolean) => repo.rebase(onto, autostash),
  abortOperation: ({ repo }, op: string) => repo.abortOperation(op),
  continueOperation: ({ repo }, op: string) => repo.continueOperation(op),
  cherryPick: ({ repo }, sha: string) => repo.cherryPick(sha),
  revert: ({ repo }, sha: string) => repo.revert(sha),
  reset: ({ repo }, sha: string, mode: 'soft' | 'mixed' | 'hard') => repo.reset(sha, mode),
  rewordCommit: ({ repo }, sha: string, message: string) => repo.rewordCommit(sha, message),
  dropCommit: ({ repo }, sha: string) => repo.dropCommit(sha),
  createTag: ({ repo }, n: string, sha: string, m?: string) => repo.createTag(n, sha, m),
  deleteTag: ({ repo }, n: string) => repo.deleteTag(n),
  fetch: ({ repo }, o?: FetchOptions) => repo.fetch(o),
  pull: ({ repo }, o?: PullOptions | boolean) => repo.pull(o),
  push: ({ repo }, o) => repo.push(o),
  stash: ({ repo }, o?: StashOptions | string) => repo.stash(o),
  stashApply: ({ repo }, ref: string, pop: boolean) => repo.stashApply(ref, pop),
  stashDrop: ({ repo }, ref: string) => repo.stashDrop(ref),

  // submodules
  submodules: ({ repo }) => repo.submodules(),
  superproject: ({ repo }) => repo.superproject(),
  submoduleUpdate: ({ repo }, paths?: string[], o?: { init?: boolean; remote?: boolean }) => repo.submoduleUpdate(paths, o),
  submoduleSync: ({ repo }) => repo.submoduleSync(),
  submoduleAdd: ({ repo }, url: string, path: string, branch?: string) => repo.submoduleAdd(url, path, branch),
  submoduleDeinit: ({ repo }, path: string) => repo.submoduleDeinit(path),
  submodulePath: ({ repo }, path: string) => join(repo.root, path),

  // hooks
  hooksOverview: ({ hooks }) => hooks.overview(),
  readHook: ({ hooks }, n: HookName) => hooks.read(n),
  writeHook: ({ hooks }, n: HookName, c: string) => hooks.write(n, c),
  setHookEnabled: ({ hooks }, n: HookName, e: boolean) => hooks.setEnabled(n, e),
  removeHook: ({ hooks }, n: HookName) => hooks.remove(n),
  makeHookExecutable: ({ hooks }, n: HookName) => hooks.makeExecutable(n),
  runHook: ({ hooks }, n: HookName, msg?: string) => hooks.run(n, msg)
}

// ------------------------------------------------------------------ IPC: file editor windows

type EditorHandler = (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown

const editorApi: Record<string, EditorHandler> = {
  /** Opens a file as it is on disk now in its own editor window */
  openEditor: (_e, path: string) => openEditor(path, editorOptions(__dirname, iconPath, getSettings().theme === 'dark')),
  pickFile: (e, defaultPath?: string) => pickFile(e, defaultPath),
  pathKind: (_e, p: string) => pathKind(p),
  readFile: (_e, path: string) => readEditorFile(path),
  writeFile: (e, path: string, text: string, eol: 'CRLF' | 'LF', bom: boolean) => writeEditorFile(e, path, text, eol, bom),
  editorDirty: (e, dirty: boolean) => setEditorDirty(e, dirty),
  editorPath: (e, path: string) => setEditorPath(e, path),
  editorClose: (e) => closeEditor(e)
}

ipcMain.handle('ody:invoke', async (e, method: string, args: unknown[]) => {
  const ed = editorApi[method]
  if (ed) return ed(e, ...args)
  const fn = appApi[method]
  if (!fn) throw new Error(`Unknown method ${method}`)
  return fn(...args)
})

ipcMain.handle('ody:repo', async (_e, root: string, method: string, args: unknown[]) => {
  const fn = repoApi[method]
  if (!fn) throw new Error(`Unknown method ${method}`)
  return fn(register(root), ...args)
})

// ------------------------------------------------------------------ window

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: getSettings().theme === 'dark' ? '#1c1d1e' : '#f6f3ec',
    title: 'Odysseus',
    icon: existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    show: false,
    // Custom title bar: frameless on Windows/Linux, inset traffic lights on macOS.
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 11 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('focus', () => send('focus', null))
  win.on('maximize', () => send('maximized', true))
  win.on('unmaximize', () => send('maximized', false))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Scrolling jumps straight to its target instead of easing there.
app.commandLine.appendSwitch('disable-smooth-scrolling')

// Windows shows notifications under this id; it matches the installer's shortcut.
if (process.platform === 'win32') app.setAppUserModelId('com.odysseus.git')

// The installer runs `Odysseus --install-skills` to put the commit skill into each AI CLI.
if (process.argv.includes('--install-skills')) {
  installAiSkills()
  app.exit(0)
}

app.whenReady().then(async () => {
  installAiSkills()
  loadStore()
  await initEnv(getSettings())
  if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(iconPath)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('before-quit', () => {
  runner.cancelAll()
  terminals.killAll()
  for (const root of [...open.keys()]) unregister(root)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
