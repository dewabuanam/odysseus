import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { buildEnv, diagnostics, envPath, initEnv } from './env'
import { GitRepo, type DiffSource } from './git/repo'
import { HookService } from './git/hooks'
import { GitRunner } from './git/runner'
import {
  addRecent,
  configurePortableMode,
  getLastRepo,
  getRecent,
  getSettings,
  loadStore,
  removeRecent,
  setSettings
} from './store'
import type { FetchOptions, FileDiff, HookName, MergeOptions, PullOptions, Settings, StashOptions } from '@shared/types'

let win: BrowserWindow | null = null
let repo: GitRepo | null = null
let hooks: HookService | null = null
let watcher: FSWatcher | null = null
let changeTimer: NodeJS.Timeout | null = null

configurePortableMode()

const iconPath = join(__dirname, '../../resources/icon.png')

function send(channel: string, payload: unknown): void {
  win?.webContents.send('ody:event', channel, payload)
}

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

const runner = new GitRunner({
  settings: getSettings,
  env: (extra) => buildEnv(getSettings(), extra),
  events: {
    runStart: (e) => send('runStart', e),
    output: (e) => {
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
    }
  }
})

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

let pendingScopes = new Set<string>()
function watchRepo(root: string): void {
  watcher?.close()
  try {
    watcher = watch(root, { recursive: true }, (_evt, file) => {
      const scope = classify(String(file ?? '').replace(/\\/g, '/'))
      if (!scope) return
      pendingScopes.add(scope)
      if (changeTimer) clearTimeout(changeTimer)
      changeTimer = setTimeout(() => {
        send('repoChanged', { root, scopes: [...pendingScopes] })
        pendingScopes = new Set()
      }, 250)
    })
  } catch {
    watcher = null
  }
}

async function openRepo(dir: string): Promise<{ path: string; name: string }> {
  const root = await GitRepo.resolveRoot(runner, dir)
  repo = new GitRepo(root, runner)
  hooks = new HookService(root, runner, () => envPath(getSettings()))
  addRecent(root)
  watchRepo(root)
  win?.setTitle(`${root.split(/[\\/]/).pop()} - Odysseus`)
  return { path: root, name: root.split(/[\\/]/).pop() ?? root }
}

function requireRepo(): GitRepo {
  if (!repo) throw new Error('No repository open')
  return repo
}

function requireHooks(): HookService {
  if (!hooks) throw new Error('No repository open')
  return hooks
}

type Handler = (...args: any[]) => unknown

const api: Record<string, Handler> = {
  // app
  getSettings: () => getSettings(),
  setSettings: async (patch: Partial<Settings>) => {
    const s = setSettings(patch)
    if ('useLoginShellEnv' in patch) await initEnv(s)
    return s
  },
  diagnostics: () => diagnostics(getSettings()),
  recentRepos: () => getRecent(),
  removeRecent: (p: string) => removeRecent(p),
  lastRepo: () => getLastRepo(),
  pickRepo: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  openRepo: (dir: string) => openRepo(dir),
  initRepo: async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled) return null
    await runner.data(r.filePaths[0], ['init'])
    return openRepo(r.filePaths[0])
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
  openExternal: (p: string) => shell.openPath(p),
  showInFolder: (p: string) => shell.showItemInFolder(p),
  cancelRun: (id: string) => runner.cancel(id),
  platform: () => process.platform,
  windowMinimize: () => win?.minimize(),
  windowToggleMaximize: () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()),
  windowClose: () => win?.close(),
  windowIsMaximized: () => win?.isMaximized() ?? false,

  // read
  status: () => requireRepo().status(),
  log: (limit?: number, knownKey?: string) => requireRepo().log(limit, knownKey),
  commitDetail: (sha: string) => requireRepo().commitDetail(sha),
  diff: (src: DiffSource, context?: number) => requireRepo().diff(src, context),
  branches: () => requireRepo().branches(),
  tags: () => requireRepo().tags(),
  stashes: () => requireRepo().stashes(),
  remotes: () => requireRepo().remotes(),
  lastCommitMessage: () => requireRepo().lastCommitMessage(),

  // index
  stage: (paths: string[]) => requireRepo().stage(paths),
  stageAll: () => requireRepo().stageAll(),
  unstage: (paths: string[]) => requireRepo().unstage(paths),
  unstageAll: () => requireRepo().unstageAll(),
  discard: (paths: string[], untracked: string[]) => requireRepo().discard(paths, untracked),
  applyHunk: (file: FileDiff, hunk: number, lines: number[] | null, mode: 'stage' | 'unstage' | 'discard') =>
    requireRepo().applyHunk(file, hunk, lines, mode),

  // write
  commit: (o) => requireRepo().commit(o),
  checkout: (ref: string) => requireRepo().checkout(ref),
  checkoutRemote: (ref: string) => requireRepo().checkoutRemote(ref),
  createBranch: (n: string, s?: string, c?: boolean) => requireRepo().createBranch(n, s, c),
  deleteBranch: (n: string, f?: boolean) => requireRepo().deleteBranch(n, f),
  merge: (ref: string, opts?: MergeOptions | boolean) => requireRepo().merge(ref, opts),
  rebase: (onto: string, autostash?: boolean) => requireRepo().rebase(onto, autostash),
  abortOperation: (op: string) => requireRepo().abortOperation(op),
  continueOperation: (op: string) => requireRepo().continueOperation(op),
  cherryPick: (sha: string) => requireRepo().cherryPick(sha),
  revert: (sha: string) => requireRepo().revert(sha),
  reset: (sha: string, mode: 'soft' | 'mixed' | 'hard') => requireRepo().reset(sha, mode),
  createTag: (n: string, sha: string, m?: string) => requireRepo().createTag(n, sha, m),
  deleteTag: (n: string) => requireRepo().deleteTag(n),
  fetch: (o?: FetchOptions) => requireRepo().fetch(o),
  pull: (o?: PullOptions | boolean) => requireRepo().pull(o),
  push: (o) => requireRepo().push(o),
  stash: (o?: StashOptions | string) => requireRepo().stash(o),
  stashApply: (ref: string, pop: boolean) => requireRepo().stashApply(ref, pop),
  stashDrop: (ref: string) => requireRepo().stashDrop(ref),

  // submodules
  submodules: () => requireRepo().submodules(),
  superproject: () => requireRepo().superproject(),
  submoduleUpdate: (paths?: string[], o?: { init?: boolean; remote?: boolean }) => requireRepo().submoduleUpdate(paths, o),
  submoduleSync: () => requireRepo().submoduleSync(),
  submoduleAdd: (url: string, path: string, branch?: string) => requireRepo().submoduleAdd(url, path, branch),
  submoduleDeinit: (path: string) => requireRepo().submoduleDeinit(path),
  submodulePath: (path: string) => join(requireRepo().root, path),

  // hooks
  hooksOverview: () => requireHooks().overview(),
  readHook: (n: HookName) => requireHooks().read(n),
  writeHook: (n: HookName, c: string) => requireHooks().write(n, c),
  setHookEnabled: (n: HookName, e: boolean) => requireHooks().setEnabled(n, e),
  removeHook: (n: HookName) => requireHooks().remove(n),
  makeHookExecutable: (n: HookName) => requireHooks().makeExecutable(n),
  runHook: (n: HookName, msg?: string) => requireHooks().run(n, msg)
}

ipcMain.handle('ody:invoke', async (_e, method: string, args: unknown[]) => {
  const fn = api[method]
  if (!fn) throw new Error(`Unknown method ${method}`)
  return fn(...args)
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#f6f3ec',
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

app.whenReady().then(async () => {
  loadStore()
  await initEnv(getSettings())
  if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(iconPath)
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('before-quit', () => {
  runner.cancelAll()
  watcher?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
