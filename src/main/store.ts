import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AiPaneState, HistoryEntry, RepoSummary, Settings, Workspace } from '@shared/types'

interface StoreData {
  settings: Settings
  recentRepos: string[]
  lastRepo: string | null
  /** Open repository tabs, restored on launch */
  tabs: string[]
  activeTab: string | null
  /** Hidden branch refs per repository */
  hidden: Record<string, string[]>
  /** Tab groups */
  workspaces: Workspace[]
  /** AI pane sessions, restored on launch */
  aiPane: AiPaneState
  /** Names shown for repositories instead of their folder name, by normalized path */
  aliases: Record<string, string>
}

const DEFAULTS: StoreData = {
  settings: {
    extraPath: [],
    useLoginShellEnv: true,
    forceColor: true,
    hookTimeoutSec: 0,
    gitPath: 'git',
    theme: 'light',
    keymap: 'default',
    terminalShell: '',
    terminalProfiles: [
      { name: 'Claude Code', command: 'claude' },
      { name: 'Codex', command: 'codex' },
      { name: 'Gemini', command: 'gemini' },
      { name: 'Copilot', command: 'copilot' }
    ],
    terminalDefault: 'Claude Code',
    terminalPrewarm: true,
    remoteControl: false,
    remoteControlScopes: {},
    remoteControlSetup: false
  },
  recentRepos: [],
  lastRepo: null,
  tabs: [],
  activeTab: null,
  hidden: {},
  workspaces: [],
  aiPane: { open: false, sessions: [], active: {} },
  aliases: {}
}

let data: StoreData = structuredClone(DEFAULTS)

/**
 * Portable mode: keep all app data next to the executable so Odysseus can run from a USB
 * stick / shared folder without installing or touching %APPDATA%. Enabled when running the
 * electron-builder portable .exe, or when an `odysseus-data` folder sits next to the app.
 * Must be called before `app.whenReady()`.
 */
export function configurePortableMode(): string | null {
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath('exe'))
  const dataDir = join(exeDir, 'odysseus-data')
  if (process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged && existsSync(dataDir))) {
    mkdirSync(dataDir, { recursive: true })
    app.setPath('userData', dataDir)
    return dataDir
  }
  return null
}

function file(): string {
  return join(app.getPath('userData'), 'odysseus.json')
}

export function loadStore(): void {
  try {
    if (existsSync(file())) {
      const parsed = JSON.parse(readFileSync(file(), 'utf8'))
      data = { ...DEFAULTS, ...parsed, settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) } }
    }
  } catch {
    data = structuredClone(DEFAULTS)
  }
}

function save(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify(data, null, 2))
}

export function getSettings(): Settings {
  return data.settings
}

export function setSettings(patch: Partial<Settings>): Settings {
  data.settings = { ...data.settings, ...patch }
  save()
  return data.settings
}

export function addRecent(path: string): void {
  data.recentRepos = [path, ...data.recentRepos.filter((p) => p !== path)].slice(0, 15)
  data.lastRepo = path
  save()
}

export function removeRecent(path: string): void {
  data.recentRepos = data.recentRepos.filter((p) => p !== path)
  if (data.lastRepo === path) data.lastRepo = null
  save()
}

const aliasKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The repository's name in Odysseus: its alias, else its folder name. */
export function repoName(path: string): string {
  return data.aliases?.[aliasKey(path)] || basename(path) || path
}

/** Sets the repository's alias; an empty one goes back to the folder name. */
export function setAlias(path: string, alias: string): RepoSummary {
  const aliases = { ...(data.aliases ?? {}) }
  if (alias.trim() && alias.trim() !== basename(path)) aliases[aliasKey(path)] = alias.trim()
  else delete aliases[aliasKey(path)]
  data.aliases = aliases
  save()
  return { path, name: repoName(path) }
}

export function getRecent(): RepoSummary[] {
  return data.recentRepos.filter((p) => existsSync(p)).map((p) => ({ path: p, name: repoName(p) }))
}

export function getLastRepo(): string | null {
  return data.lastRepo && existsSync(data.lastRepo) ? data.lastRepo : null
}

export function getTabs(): { tabs: RepoSummary[]; active: string | null } {
  const tabs = (data.tabs ?? []).filter((p) => existsSync(p)).map((p) => ({ path: p, name: repoName(p) }))
  // Upgrade path from single-repo versions
  if (!tabs.length && data.lastRepo && existsSync(data.lastRepo)) tabs.push({ path: data.lastRepo, name: repoName(data.lastRepo) })
  // No active tab (a collapsed workspace hid it) stays that way, showing the start page.
  const active = tabs.some((t) => t.path === data.activeTab) ? data.activeTab : data.activeTab === null && data.tabs?.length ? null : tabs[0]?.path ?? null
  return { tabs, active }
}

export function setTabs(tabs: string[], active: string | null): void {
  data.tabs = tabs
  data.activeTab = active
  save()
}

export function getWorkspaces(): Workspace[] {
  return data.workspaces ?? []
}

export function setWorkspaces(ws: Workspace[]): void {
  data.workspaces = ws
  save()
}

export function getAiPane(): AiPaneState {
  return data.aiPane ?? DEFAULTS.aiPane
}

export function setAiPane(pane: AiPaneState): void {
  data.aiPane = pane
  save()
}

export function getHidden(root: string): string[] {
  return data.hidden?.[root] ?? []
}

export function setHidden(root: string, refs: string[]): string[] {
  data.hidden = { ...(data.hidden ?? {}), [root]: [...new Set(refs)] }
  save()
  return data.hidden[root]
}

// ------------------------------------------------------------------ command history

const HISTORY_MAX = 500
const OUTPUT_TAIL = 6000
let history: HistoryEntry[] | null = null
let historyTimer: NodeJS.Timeout | null = null

function historyFile(): string {
  return join(app.getPath('userData'), 'history.json')
}

function loadHistory(): HistoryEntry[] {
  if (history) return history
  try {
    history = existsSync(historyFile()) ? JSON.parse(readFileSync(historyFile(), 'utf8')) : []
  } catch {
    history = []
  }
  return history!
}

export function addHistory(e: HistoryEntry): void {
  const list = loadHistory()
  list.unshift({ ...e, output: e.output.length > OUTPUT_TAIL ? '…\n' + e.output.slice(-OUTPUT_TAIL) : e.output })
  if (list.length > HISTORY_MAX) list.length = HISTORY_MAX
  // Batch disk writes; history can be appended in quick succession by a queue.
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(historyFile(), JSON.stringify(list))
  }, 500)
}

export function getHistory(root?: string, limit = 150): HistoryEntry[] {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const list = loadHistory()
  return (root ? list.filter((h) => norm(h.root) === norm(root)) : list).slice(0, limit)
}
