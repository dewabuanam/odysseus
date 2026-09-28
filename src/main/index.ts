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
import type { FileDiff, HookName, Settings } from '@shared/types'

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

const runner = new GitRunner({
  settings: getSettings,
  env: (extra) => buildEnv(getSettings(), extra),
  events: {
    runStart: (e) => send('runStart', e),
    output: (e) => send('output', e),
    hook: (e) => send('hook', e),
    runEnd: (e) => send('runEnd', e)
  }
})

function watchRepo(root: string): void {
  watcher?.close()
  try {
    watcher = watch(root, { recursive: true }, (_evt, file) => {
      const f = String(file ?? '').replace(/\\/g, '/')
      if (f.includes('node_modules/') || f.startsWith('.git/objects') || f.endsWith('.lock')) return
      if (f.startsWith('.git/') && !/^\.git\/(HEAD|index|refs|MERGE_HEAD|rebase-|FETCH_HEAD|packed-refs|hooks)/.test(f)) return
      if (changeTimer) clearTimeout(changeTimer)
      changeTimer = setTimeout(() => send('repoChanged', { root }), 350)
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
  win?.setTitle(`${root.split(/[\\/]/).pop()} — Odysseus`)
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

  // read
  status: () => requireRepo().status(),
  log: (limit?: number) => requireRepo().log(limit),
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
  merge: (ref: string, noVerify?: boolean) => requireRepo().merge(ref, noVerify),
  rebase: (onto: string) => requireRepo().rebase(onto),
  abortOperation: (op: string) => requireRepo().abortOperation(op),
  continueOperation: (op: string) => requireRepo().continueOperation(op),
  cherryPick: (sha: string) => requireRepo().cherryPick(sha),
  revert: (sha: string) => requireRepo().revert(sha),
  reset: (sha: string, mode: 'soft' | 'mixed' | 'hard') => requireRepo().reset(sha, mode),
  createTag: (n: string, sha: string, m?: string) => requireRepo().createTag(n, sha, m),
  deleteTag: (n: string) => requireRepo().deleteTag(n),
  fetch: () => requireRepo().fetch(),
  pull: (rebase?: boolean) => requireRepo().pull(rebase),
  push: (o) => requireRepo().push(o),
  stash: (m?: string) => requireRepo().stash(m),
  stashApply: (ref: string, pop: boolean) => requireRepo().stashApply(ref, pop),
  stashDrop: (ref: string) => requireRepo().stashDrop(ref),

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
    backgroundColor: '#0d1017',
    title: 'Odysseus',
    icon: existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.on('focus', () => send('focus', null))
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
