import { programOf } from './types'

/**
 * The text typed into a terminal session for files dropped or pasted into it, in the form the
 * program there picks up: Claude Code and Codex attach an image from its plain path, Gemini and
 * Copilot take `@path` mentions, and a shell gets each path quoted for that shell.
 *
 * `command` is the session's program (empty for a shell), `shell` the shell's executable name.
 */
export function attachText(paths: string[], command: string, shell: string, win: boolean): string {
  const program = programOf(command)
  const sh = programOf(shell)
  const one = (p: string): string => {
    if (program === 'gemini') {
      // Gemini reads a backslash as an escape, so use forward slashes and escape spaces.
      return '@' + (win ? p.replace(/\\/g, '/') : p).replace(/ /g, '\\ ')
    }
    if (program === 'copilot') return '@' + dquote(p)
    if (program) return dquote(p)
    if (sh === 'cmd') return dquote(p)
    if (sh === 'powershell' || sh === 'pwsh' || (!sh && win)) return /^[\w:\\/.-]+$/.test(p) ? p : `'${p.replace(/'/g, "''")}'`
    return /^[\w/.-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`
  }
  return paths.length ? paths.map(one).join(' ') + ' ' : ''
}

/** Double quotes around a path with spaces, the way terminals insert a dropped file. */
const dquote = (p: string) => (/[\s&()^;,]/.test(p) ? `"${p}"` : p)
