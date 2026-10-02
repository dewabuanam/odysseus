import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { IPty } from 'node-pty'
import type { TerminalProfile } from '@shared/types'
import { which } from './env'

/**
 * Interactive terminals for the right-hand pane (a shell, or an AI CLI such as `claude`).
 * Each session is a real pseudo-terminal, so full-screen and prompt-driven programs work.
 * node-pty is loaded lazily: a missing native build only disables the pane, not the app.
 */

const isWin = process.platform === 'win32'

type Pty = typeof import('node-pty')
let pty: Pty | null | undefined

function loadPty(): Pty {
  if (pty === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pty = require('node-pty') as Pty
    } catch (e) {
      console.error('node-pty unavailable', e)
      pty = null
    }
  }
  if (!pty) throw new Error('Terminal support is not available in this build')
  return pty
}

export function defaultShell(): string {
  if (isWin) {
    const pwsh = ['C:\\Program Files\\PowerShell\\7\\pwsh.exe']
    return pwsh.find(existsSync) ?? 'powershell.exe'
  }
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

/** Official install commands for the AI CLIs we offer, keyed by the program name. */
export const KNOWN_INSTALLS: Record<string, string> = {
  claude: isWin ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
  codex: 'npm install -g @openai/codex',
  gemini: 'npm install -g @google/gemini-cli',
  copilot: 'npm install -g @github/copilot'
}

/**
 * Where these CLIs land when installed. A program installed after Odysseus started (by our
 * installer, or in the pane itself) isn't on the PATH we inherited, so add these up front.
 */
function cliDirs(): string[] {
  const home = homedir()
  const dirs = [join(home, '.local', 'bin')]
  if (isWin) {
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'))
  } else dirs.push(join(home, '.npm-global', 'bin'), '/usr/local/bin', '/opt/homebrew/bin')
  return dirs
}

const shellKind = (exe: string) => {
  const base = exe.toLowerCase().split(/[\\/]/).pop() ?? ''
  return /^(pwsh|powershell)(\.exe)?$/.test(base) ? 'pwsh' : /^cmd(\.exe)?$/.test(base) ? 'cmd' : 'posix'
}

interface Events {
  data(id: number, data: string): void
  exit(id: number, code: number): void
}

export class TerminalService {
  private sessions = new Map<number, IPty>()
  private nextId = 1

  constructor(private readonly events: Events) {}

  /**
   * Starts a session in `cwd`. A profile with a command runs it inside the user's shell, so
   * PATH lookups and shell shims (claude.cmd, npm globals) behave as they do in a terminal,
   * and the shell stays open when the program exits. A program that isn't installed yet is
   * installed first with its official install command.
   */
  create(cwd: string, cols: number, rows: number, env: NodeJS.ProcessEnv, profile: TerminalProfile, shell: string): number {
    const p = loadPty()
    const exe = shell.trim() || defaultShell()
    const kind = shellKind(exe)

    // An interactive terminal can prompt and open editors, unlike Odysseus' own git runs.
    const termEnv: NodeJS.ProcessEnv = { ...env }
    for (const k of ['GIT_TERMINAL_PROMPT', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR']) delete termEnv[k]
    // A PSModulePath inherited from PowerShell 7 makes Windows PowerShell load the wrong
    // PSReadLine ("Cannot load PSReadline module"); each PowerShell rebuilds its own default.
    if (kind === 'pwsh') for (const k of Object.keys(termEnv)) if (k.toUpperCase() === 'PSMODULEPATH') delete termEnv[k]
    const pathKey = Object.keys(termEnv).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    const parts = (termEnv[pathKey] ?? '').split(delimiter).filter(Boolean)
    termEnv[pathKey] = [...cliDirs().filter((d) => !parts.includes(d)), ...parts].join(delimiter)

    let command = profile.command.trim()
    if (command) {
      const program = command.split(/\s+/)[0]
      const install = profile.install ?? KNOWN_INSTALLS[program.toLowerCase()]
      if (install && !which(program, termEnv[pathKey] ?? '')) {
        const note = `${program} is not installed. Installing it with: ${install}`
        command =
          kind === 'pwsh' ? `Write-Host '${note.replace(/'/g, "''")}'; ${install}; ${command}`
          : kind === 'cmd' ? `echo ${note} && ${install} && ${command}`
          : `echo ${JSON.stringify(note)}; ${install} && ${command}`
      }
    }

    // npm installs CLIs (codex, gemini, copilot) with .ps1 launchers, which Windows' default
    // "Restricted" policy refuses to run. RemoteSigned, for this session only, runs local
    // scripts and still blocks unsigned downloaded ones; the system setting is untouched.
    const args: string[] = kind === 'pwsh' && isWin ? ['-ExecutionPolicy', 'RemoteSigned'] : []
    if (command) {
      if (kind === 'pwsh') args.push('-NoLogo', '-NoExit', '-Command', command)
      else if (kind === 'cmd') args.push('/K', command)
      else args.push('-ic', `${command}; exec ${JSON.stringify(exe)} -i`)
    } else if (kind === 'pwsh') args.push('-NoLogo')

    const term = p.spawn(exe, args, {
      name: 'xterm-256color',
      cols: Math.max(2, cols),
      rows: Math.max(2, rows),
      cwd,
      env: { ...termEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
      ...(isWin ? { useConpty: true } : {})
    })
    const id = this.nextId++
    this.sessions.set(id, term)
    term.onData((d) => this.events.data(id, d))
    term.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.events.exit(id, exitCode)
    })
    return id
  }

  write(id: number, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.resize(Math.max(2, cols), Math.max(2, rows))
    } catch {
      /* session already gone */
    }
  }

  kill(id: number): void {
    const t = this.sessions.get(id)
    this.sessions.delete(id)
    try {
      t?.kill()
    } catch {
      /* already exited */
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
