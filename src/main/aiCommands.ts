import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { programOf, type AiCommand } from '@shared/types'

/**
 * Slash commands an AI CLI offers in a folder: its built-ins, plus the skills and custom
 * commands found on disk (the user's, the project's and, for Claude Code, installed plugins').
 * The palette lists them so "Claude: Commit" types `/commit` into the session.
 */

const CLAUDE_BUILTINS: AiCommand[] = [
  { name: 'init', description: 'Create a CLAUDE.md that documents this project', source: 'built-in' },
  { name: 'review', description: 'Review a pull request', source: 'built-in' },
  { name: 'security-review', description: 'Security review of the pending changes', source: 'built-in' },
  { name: 'compact', description: 'Compact the conversation, optionally with focus instructions', source: 'built-in' },
  { name: 'clear', description: 'Start a fresh conversation', source: 'built-in' },
  { name: 'context', description: 'Show how much of the context window is used', source: 'built-in' },
  { name: 'model', description: 'Switch the model', source: 'built-in' },
  { name: 'resume', description: 'Resume an earlier conversation', source: 'built-in' },
  { name: 'memory', description: 'Edit the memory files', source: 'built-in' },
  { name: 'remote-control', description: 'Continue this session from claude.ai or the Claude app', source: 'built-in' }
]

const CODEX_BUILTINS: AiCommand[] = [
  { name: 'init', description: 'Create an AGENTS.md for this project', source: 'built-in' },
  { name: 'review', description: 'Review the current changes', source: 'built-in' },
  { name: 'diff', description: 'Show the git diff', source: 'built-in' },
  { name: 'compact', description: 'Summarize the conversation to free context', source: 'built-in' },
  { name: 'new', description: 'Start a new conversation', source: 'built-in' },
  { name: 'model', description: 'Switch the model', source: 'built-in' },
  { name: 'status', description: 'Show session status', source: 'built-in' }
]

const GEMINI_BUILTINS: AiCommand[] = [
  { name: 'init', description: 'Create a GEMINI.md for this project', source: 'built-in' },
  { name: 'compress', description: 'Summarize the conversation to free context', source: 'built-in' },
  { name: 'clear', description: 'Clear the screen and conversation', source: 'built-in' },
  { name: 'memory', description: 'Manage memory', source: 'built-in' },
  { name: 'stats', description: 'Show session statistics', source: 'built-in' }
]

/** `name` and `description` from a Markdown file's front matter, else its first text line. */
function frontMatter(file: string): { name?: string; description?: string; hidden?: boolean } {
  let text: string
  try {
    text = readFileSync(file, 'utf8').slice(0, 8000)
  } catch {
    return {}
  }
  const out: { name?: string; description?: string; hidden?: boolean } = {}
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (m) {
    const field = (k: string) => {
      const f = m[1].match(new RegExp(`^${k}:[ \\t]*(.*)$((?:\\r?\\n[ \\t]+.*)*)`, 'm'))
      if (!f) return undefined
      const first = f[1].trim()
      // A YAML block (`|`, `>-`) or a value wrapped onto indented lines
      const text = /^[|>][+-]?$/.test(first) ? f[2] : `${first} ${f[2]}`
      return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ').replace(/^["']|["']$/g, '')
    }
    out.name = field('name') || undefined
    out.description = field('description') || undefined
    out.hidden = field('user-invocable') === 'false'
  }
  if (!out.description) {
    const body = m ? text.slice(m[0].length) : text
    out.description = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)
  }
  if (out.description && out.description.length > 160) out.description = out.description.slice(0, 157) + '...'
  return out
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Files under `dir` with the extension, any depth; subfolders become `a:b` name segments. */
function filesIn(dir: string, ext: string, depth = 3): string[] {
  if (depth < 0 || !isDir(dir)) return []
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...filesIn(p, ext, depth - 1))
    else if (e.name.toLowerCase().endsWith(ext)) out.push(p)
  }
  return out
}

const nameFrom = (dir: string, file: string, ext: string) => relative(dir, file).slice(0, -ext.length).split(sep).join(':')

/** Claude Code skills: one folder per skill with a SKILL.md, possibly grouped one level down. */
function claudeSkills(dir: string, source: string, prefix = ''): AiCommand[] {
  if (!isDir(dir)) return []
  const out: AiCommand[] = []
  const visit = (d: string, depth: number) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      // Skill folders are often symlinks into a synced or shared folder.
      if (!isDir(p)) continue
      const md = join(p, 'SKILL.md')
      if (existsSync(md)) {
        const fm = frontMatter(md)
        if (!fm.hidden) out.push({ name: prefix + (fm.name || e.name), description: fm.description, source })
      } else if (depth > 0) visit(p, depth - 1)
    }
  }
  visit(dir, 1)
  return out
}

function claudeCommands(dir: string, source: string, prefix = ''): AiCommand[] {
  return filesIn(dir, '.md').map((f) => {
    const fm = frontMatter(f)
    return { name: prefix + nameFrom(dir, f, '.md'), description: fm.description, source }
  })
}

const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

function claudePlugins(cwd: string): AiCommand[] {
  const root = join(homedir(), '.claude')
  let installed: Record<string, { scope?: string; projectPath?: string; installPath?: string }[]> = {}
  let enabled: Record<string, boolean> = {}
  try {
    installed = JSON.parse(readFileSync(join(root, 'plugins', 'installed_plugins.json'), 'utf8')).plugins ?? {}
  } catch {
    return []
  }
  try {
    enabled = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')).enabledPlugins ?? {}
  } catch {
    /* no settings */
  }
  const out: AiCommand[] = []
  for (const [id, installs] of Object.entries(installed)) {
    if (enabled[id] === false) continue
    const plugin = id.split('@')[0]
    const inst = installs.find((i) => i.scope === 'user' || (i.projectPath && samePath(i.projectPath, cwd)))
    if (!inst?.installPath) continue
    const source = `plugin ${plugin}`
    out.push(...claudeSkills(join(inst.installPath, 'skills'), source, `${plugin}:`), ...claudeCommands(join(inst.installPath, 'commands'), source, `${plugin}:`))
  }
  return out
}

function geminiCommands(dir: string, source: string): AiCommand[] {
  return filesIn(dir, '.toml').map((f) => {
    let description: string | undefined
    try {
      description = readFileSync(f, 'utf8').match(/^description\s*=\s*["'](.*)["']\s*$/m)?.[1]
    } catch {
      /* unreadable */
    }
    return { name: nameFrom(dir, f, '.toml'), description, source }
  })
}

/**
 * Results are kept for a little while: the list is read again on every tab switch, and reading
 * it scans folders on disk in the main process, which would stall the terminals meanwhile.
 */
const CACHE_MS = 30_000
const cache = new Map<string, { at: number; list: AiCommand[] }>()

export function aiCommands(command: string, cwd: string): AiCommand[] {
  const key = JSON.stringify([command, cwd])
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list
  const list = readAiCommands(command, cwd)
  cache.set(key, { at: Date.now(), list })
  return list
}

function readAiCommands(command: string, cwd: string): AiCommand[] {
  const home = homedir()
  let list: AiCommand[]
  switch (programOf(command)) {
    case 'claude':
      list = [
        ...claudeSkills(join(cwd, '.claude', 'skills'), 'project'),
        ...claudeCommands(join(cwd, '.claude', 'commands'), 'project'),
        ...claudeSkills(join(home, '.claude', 'skills'), 'personal'),
        ...claudeCommands(join(home, '.claude', 'commands'), 'personal'),
        ...claudePlugins(cwd),
        ...CLAUDE_BUILTINS
      ]
      break
    case 'codex':
      list = [
        ...filesIn(join(home, '.codex', 'prompts'), '.md', 0).map((f) => ({ name: `prompts:${basename(f, '.md')}`, description: frontMatter(f).description, source: 'personal' })),
        ...CODEX_BUILTINS
      ]
      break
    case 'gemini':
      list = [...geminiCommands(join(cwd, '.gemini', 'commands'), 'project'), ...geminiCommands(join(home, '.gemini', 'commands'), 'personal'), ...GEMINI_BUILTINS]
      break
    default:
      list = []
  }
  // A project command shadows a personal or built-in one of the same name.
  const seen = new Set<string>()
  return list.filter((c) => !seen.has(c.name) && (seen.add(c.name), true))
}
