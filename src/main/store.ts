import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { RepoSummary, Settings } from '@shared/types'

interface StoreData {
  settings: Settings
  recentRepos: string[]
  lastRepo: string | null
}

const DEFAULTS: StoreData = {
  settings: {
    extraPath: [],
    useLoginShellEnv: true,
    forceColor: true,
    hookTimeoutSec: 0,
    gitPath: 'git',
    theme: 'dark'
  },
  recentRepos: [],
  lastRepo: null
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

export function getRecent(): RepoSummary[] {
  return data.recentRepos.filter((p) => existsSync(p)).map((p) => ({ path: p, name: basename(p) }))
}

export function getLastRepo(): string | null {
  return data.lastRepo && existsSync(data.lastRepo) ? data.lastRepo : null
}
