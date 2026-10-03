import type { Terminal } from '@xterm/xterm'
import type { AiState } from '@shared/types'

/**
 * Reads an AI CLI's state from its screen. Works for Claude Code, Codex, Gemini and Copilot,
 * which all show a permission or confirmation prompt when they need you, and animate (or say
 * "esc to interrupt") while they work.
 */
const NEEDS_ACTION = [
  /do you want to (proceed|make|create|run|allow|continue)/i,
  /enter to confirm/i,
  /esc to cancel/i,
  /\(y\/n\)|\[y\/n\]|\[Y\/n\]|\[y\/N\]/,
  /^\s*[❯>›]\s*1\.\s*(yes|allow|approve)/im,
  /\b(allow|approve|deny)\b.*\?/i,
  /waiting for (your )?(approval|confirmation|input)/i,
  /press enter to continue/i
]
const WORKING = [/esc to interrupt/i, /ctrl\+c to (interrupt|cancel)/i]

/** How long after the last output a session still counts as working. */
const QUIET_MS = 1800

export function visibleText(term: Terminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let y = buf.viewportY; y < buf.viewportY + term.rows; y++) lines.push(buf.getLine(y)?.translateToString(true) ?? '')
  return lines.join('\n')
}

export function detectAiState(screen: string, lastOutputAt: number, now = Date.now()): AiState {
  if (WORKING.some((r) => r.test(screen))) return 'working'
  if (NEEDS_ACTION.some((r) => r.test(screen))) return 'waiting'
  return now - lastOutputAt < QUIET_MS ? 'working' : 'idle'
}

/** A shell's prompt at the start of the cursor line: PowerShell, cmd, or a Unix shell. */
const PROMPT = [/^PS [^>]*> ?/, /^[A-Za-z]:\\[^>]*>/, /^\S*@\S*[:\s].*[$#%] /, /^[$#%❯›>] /]
/** What a command running in a shell asks before it goes on. */
const SHELL_ASKS = [/\[Y\] Yes/, /\(y\/n\)\??\s*$/im, /press any key/i, /(password|passphrase)( for [^:]*)?:\s*$/im]

/**
 * Reads a shell's state: idle at its prompt (and before anything was run), needs you when the
 * command running asks something, working otherwise.
 */
export function detectShellState(term: Terminal, ran: boolean): AiState {
  if (!ran) return 'idle'
  const buf = term.buffer.active
  const line = buf.getLine(buf.baseY + buf.cursorY)?.translateToString(false) ?? ''
  const beforeCursor = line.slice(0, buf.cursorX)
  if (PROMPT.some((r) => r.test(line)) || /[$#%❯›>] $/.test(beforeCursor)) return 'idle'
  const tail = visibleText(term).trimEnd().split('\n').slice(-5).join('\n')
  if (SHELL_ASKS.some((r) => r.test(tail)) || NEEDS_ACTION.some((r) => r.test(tail))) return 'waiting'
  return 'working'
}

export const AI_LABEL: Record<AiState, string> = { working: 'working', waiting: 'needs your input', idle: 'idle' }
