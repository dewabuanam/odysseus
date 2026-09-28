// Minimal ANSI SGR → styled spans converter for hook output (colors, bold, dim, underline).

export interface AnsiSpan {
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  underline?: boolean
}

const BASIC = ['#3b4252', '#ff6b6b', '#5fd38d', '#f2c94c', '#5aa9ff', '#c678dd', '#56d4dd', '#d8dee9']
const BRIGHT = ['#6b7280', '#ff8a8a', '#7ee2a8', '#ffe08a', '#8cc4ff', '#dda0f0', '#8be9f0', '#ffffff']

function xterm256(n: number): string {
  if (n < 8) return BASIC[n]
  if (n < 16) return BRIGHT[n - 8]
  if (n < 232) {
    const i = n - 16
    const c = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

export function parseAnsi(input: string): AnsiSpan[] {
  // Carriage returns without newline are progress bars: keep only the last segment.
  const text = input
    .split('\n')
    .map((line) => {
      const parts = line.split('\r')
      return parts.length > 1 ? parts.filter((p) => p !== '').pop() ?? '' : line
    })
    .join('\n')

  const spans: AnsiSpan[] = []
  let state: Omit<AnsiSpan, 'text'> = {}
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;?]*)([A-Za-z])/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ ...state, text: text.slice(last, m.index) })
    last = re.lastIndex
    if (m[2] !== 'm') continue
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) state = {}
      else if (c === 1) state.bold = true
      else if (c === 2) state.dim = true
      else if (c === 4) state.underline = true
      else if (c === 22) state.bold = state.dim = false
      else if (c === 24) state.underline = false
      else if (c >= 30 && c <= 37) state.fg = BASIC[c - 30]
      else if (c >= 90 && c <= 97) state.fg = BRIGHT[c - 90]
      else if (c === 39) state.fg = undefined
      else if (c >= 40 && c <= 47) state.bg = BASIC[c - 40]
      else if (c >= 100 && c <= 107) state.bg = BRIGHT[c - 100]
      else if (c === 49) state.bg = undefined
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const col = xterm256(codes[i + 2] ?? 0)
        if (c === 38) state.fg = col
        else state.bg = col
        i += 2
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const col = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
        if (c === 38) state.fg = col
        else state.bg = col
        i += 4
      }
    }
  }
  if (last < text.length) spans.push({ ...state, text: text.slice(last) })
  return spans
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
}
