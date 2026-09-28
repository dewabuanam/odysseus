import { spawn, spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { EnvDiagnostics, Settings } from '@shared/types'

/**
 * GUI apps don't inherit the environment of the user's interactive shell. On macOS/Linux
 * an app launched from the dock never sources ~/.zshrc, so hooks that call `node`, `npx`,
 * `pnpm`, `python` (installed via nvm, asdf, pyenv, volta, homebrew...) fail with
 * "command not found" — the #1 reason hooks break in GUI Git clients. We resolve the login
 * shell environment once and use it for every git invocation.
 */

const isWin = process.platform === 'win32'
let loginEnv: NodeJS.ProcessEnv | null = null
let loginEnvLoaded = false
let loginShell: string | null = null

function readLoginShellEnv(): Promise<NodeJS.ProcessEnv | null> {
  if (isWin) return Promise.resolve(null)
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  loginShell = shell
  const marker = '__ODYSSEUS_ENV__'
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(shell, ['-ilc', `printf '${marker}'; env; printf '${marker}'`], {
      env: { ...process.env, ODYSSEUS_RESOLVING_ENV: '1' },
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, 8000)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('error', () => resolve(null))
    child.on('close', () => {
      clearTimeout(timer)
      const parts = out.split(marker)
      if (parts.length < 3) return resolve(null)
      const env: NodeJS.ProcessEnv = {}
      for (const line of parts[1].split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1)
      }
      resolve(env)
    })
  })
}

export async function initEnv(settings: Settings): Promise<void> {
  if (settings.useLoginShellEnv && !isWin) {
    loginEnv = await readLoginShellEnv()
    loginEnvLoaded = loginEnv !== null
  }
}

/** On Windows, make sure Git for Windows' POSIX tools (sh, sed, etc.) are reachable. */
function windowsGitDirs(gitPath: string): string[] {
  const resolved = which(gitPath, process.env.PATH || '')
  if (!resolved) return []
  // <root>/cmd/git.exe or <root>/mingw64/bin/git.exe
  let root = dirname(dirname(resolved))
  if (root.toLowerCase().endsWith('mingw64')) root = dirname(root)
  return [join(root, 'usr', 'bin'), join(root, 'mingw64', 'bin')].filter((d) => existsSync(d))
}

export function buildEnv(settings: Settings, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env, ...(loginEnv ?? {}) }
  const pathKey = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const parts = (base[pathKey] || '').split(delimiter).filter(Boolean)
  const prepend = [...settings.extraPath.filter(Boolean)]
  if (isWin) prepend.push(...windowsGitDirs(settings.gitPath))
  const merged = [...prepend, ...parts.filter((p) => !prepend.includes(p))]
  base[pathKey] = merged.join(delimiter)
  return {
    ...base,
    // Never block waiting for a terminal we don't have.
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
    LANG: base.LANG || 'en_US.UTF-8',
    ...extra
  }
}

export function which(cmd: string, pathValue: string): string | null {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').concat(['']) : ['']
  if (cmd.includes('/') || cmd.includes('\\')) return existsSync(cmd) ? cmd : null
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext.toLowerCase())
      const candidateUpper = join(dir, cmd + ext)
      for (const c of [candidate, candidateUpper]) {
        try {
          if (statSync(c).isFile()) return c
        } catch {
          /* not here */
        }
      }
    }
  }
  return null
}

export const DIAGNOSTIC_TOOLS = [
  'node', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'python', 'python3', 'pre-commit',
  'lefthook', 'php', 'ruby', 'bundle', 'go', 'cargo', 'dotnet', 'sh', 'bash'
]

export function diagnostics(settings: Settings): EnvDiagnostics {
  const env = buildEnv(settings)
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const pathValue = env[pathKey] || ''
  const tools: Record<string, string | null> = {}
  for (const t of DIAGNOSTIC_TOOLS) tools[t] = which(t, pathValue)
  const v = spawnSync(settings.gitPath, ['--version'], { env, encoding: 'utf8', windowsHide: true })
  return {
    gitPath: which(settings.gitPath, pathValue) ?? settings.gitPath,
    gitVersion: (v.stdout || v.error?.message || '').trim(),
    shell: loginShell,
    loginShellEnvLoaded: loginEnvLoaded,
    path: pathValue.split(delimiter).filter(Boolean),
    tools
  }
}

export function envPath(settings: Settings): string {
  const env = buildEnv(settings)
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  return env[pathKey] || ''
}
