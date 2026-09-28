import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { CommandResult, HookInfo, HookManager, HookName, HooksOverview } from '@shared/types'
import { DIAGNOSTIC_TOOLS, which } from '../env'
import { GitRunner } from './runner'

export const ALL_HOOKS: HookName[] = [
  'pre-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-push',
  'pre-merge-commit',
  'post-merge',
  'post-checkout',
  'pre-rebase',
  'post-rewrite',
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-auto-gc',
  'reference-transaction',
  'push-to-checkout'
]

const DISABLED_SUFFIX = '.odysseus-disabled'
const isWin = process.platform === 'win32'

export class HookService {
  constructor(
    private readonly root: string,
    private readonly git: GitRunner,
    private readonly pathValue: () => string
  ) {}

  async hooksDir(): Promise<{ dir: string; custom: boolean }> {
    let custom = false
    try {
      custom = (await this.git.data(this.root, ['config', '--get', 'core.hooksPath'])).trim() !== ''
    } catch {
      custom = false
    }
    const rel = (await this.git.data(this.root, ['rev-parse', '--git-path', 'hooks'])).trim()
    return { dir: isAbsolute(rel) ? rel : resolve(this.root, rel), custom }
  }

  detectManager(): HookManager {
    const has = (p: string) => existsSync(join(this.root, p))
    if (has('.husky')) return 'husky'
    if (has('lefthook.yml') || has('.lefthook.yml') || has('lefthook.yaml')) return 'lefthook'
    if (has('.pre-commit-config.yaml')) return 'pre-commit'
    if (has('.overcommit.yml')) return 'overcommit'
    if (has('package.json')) {
      try {
        const pkg = JSON.parse(readFileSync(join(this.root, 'package.json'), 'utf8'))
        if (pkg['simple-git-hooks']) return 'simple-git-hooks'
      } catch {
        /* ignore */
      }
    }
    return null
  }

  async overview(): Promise<HooksOverview> {
    const { dir, custom } = await this.hooksDir()
    const hooks: HookInfo[] = []
    const referenced = new Set<string>()
    for (const name of ALL_HOOKS) {
      const path = join(dir, name)
      const disabledPath = path + DISABLED_SUFFIX
      const exists = existsSync(path)
      const disabled = !exists && existsSync(disabledPath)
      const actual = exists ? path : disabled ? disabledPath : null
      let executable = false
      let interpreter: string | null = null
      let size = 0
      if (actual) {
        const st = statSync(actual)
        size = st.size
        executable = isWin ? true : (st.mode & 0o111) !== 0
        const content = readFileSync(actual, 'utf8')
        const first = content.split('\n')[0]
        interpreter = first.startsWith('#!') ? first.slice(2).trim() : null
        for (const tool of DIAGNOSTIC_TOOLS) {
          if (new RegExp(`(^|[\\s;&|(\`])${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(content)) {
            referenced.add(tool)
          }
        }
        // Scripts delegated to by husky v9 live in .husky/<hook>
        const huskyUser = join(this.root, '.husky', name)
        if (existsSync(huskyUser)) {
          const hc = readFileSync(huskyUser, 'utf8')
          for (const tool of DIAGNOSTIC_TOOLS) if (new RegExp(`(^|\\s)${tool}(\\s|$)`, 'm').test(hc)) referenced.add(tool)
        }
      }
      hooks.push({
        name,
        path: actual ?? path,
        exists: exists || disabled,
        enabled: exists,
        executable,
        sampleOnly: !actual && existsSync(path + '.sample'),
        interpreter,
        size
      })
    }
    const pathValue = this.pathValue()
    const missingCommands = [...referenced].filter((t) => !which(t, pathValue))
    return { hooksDir: dir, customPath: custom, manager: this.detectManager(), hooks, missingCommands }
  }

  async read(name: HookName): Promise<string> {
    const { dir } = await this.hooksDir()
    for (const p of [join(dir, name), join(dir, name + DISABLED_SUFFIX), join(dir, name + '.sample')]) {
      if (existsSync(p)) return readFileSync(p, 'utf8')
    }
    return ''
  }

  async write(name: HookName, content: string): Promise<void> {
    const { dir } = await this.hooksDir()
    mkdirSync(dir, { recursive: true })
    const disabledPath = join(dir, name + DISABLED_SUFFIX)
    const target = existsSync(disabledPath) ? disabledPath : join(dir, name)
    writeFileSync(target, content.replace(/\r\n/g, '\n'))
    if (!isWin) chmodSync(target, 0o755)
  }

  async setEnabled(name: HookName, enabled: boolean): Promise<void> {
    const { dir } = await this.hooksDir()
    const active = join(dir, name)
    const disabled = active + DISABLED_SUFFIX
    if (enabled && existsSync(disabled)) renameSync(disabled, active)
    if (!enabled && existsSync(active)) renameSync(active, disabled)
    if (enabled && !isWin && existsSync(active)) chmodSync(active, 0o755)
  }

  async remove(name: HookName): Promise<void> {
    const { dir } = await this.hooksDir()
    rmSync(join(dir, name), { force: true })
    rmSync(join(dir, name + DISABLED_SUFFIX), { force: true })
  }

  async makeExecutable(name: HookName): Promise<void> {
    const { dir } = await this.hooksDir()
    const p = join(dir, name)
    if (existsSync(p) && !isWin) chmodSync(p, 0o755)
  }

  /**
   * Runs a hook in isolation via `git hook run`, so it can be tested without committing.
   * Hooks that expect a message file get a temporary one with the draft message.
   */
  async run(name: HookName, draftMessage = ''): Promise<CommandResult> {
    const args = ['hook', 'run', '--ignore-missing', name]
    let tmp: string | null = null
    if (name === 'commit-msg' || name === 'prepare-commit-msg' || name === 'applypatch-msg') {
      tmp = mkdtempSync(join(tmpdir(), 'odysseus-hook-'))
      const f = join(tmp, 'COMMIT_EDITMSG')
      writeFileSync(f, draftMessage + '\n')
      args.push('--', f)
    } else if (name === 'pre-push') {
      const remote = (await this.git.data(this.root, ['remote'])).split('\n')[0] || 'origin'
      args.push('--', remote, remote)
    } else if (name === 'post-checkout') {
      args.push('--', 'HEAD', 'HEAD', '1')
    } else if (name === 'post-merge') {
      args.push('--', '0')
    }
    try {
      return await this.git.run(this.root, args, { title: `Run hook: ${name}`, input: '' })
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true })
    }
  }
}
