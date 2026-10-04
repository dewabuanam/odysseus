/** Pure text helpers for the file editor window: search, JSON formatting and line transforms. */

export interface FindOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** Most matches counted and highlighted; beyond this the editor says "10000+". */
export const MAX_MATCHES = 10000

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The search as a global regex, or an error message when the pattern is not valid. */
export function buildRegex(query: string, o: FindOptions): RegExp | string | null {
  if (!query) return null
  let src = o.regex ? query : escapeRe(query)
  if (o.wholeWord) src = `\\b(?:${src})\\b`
  try {
    return new RegExp(src, `g${o.caseSensitive ? '' : 'i'}${o.regex ? 'm' : ''}`)
  } catch (e) {
    return (e as Error).message.replace(/^Invalid regular expression: /, '')
  }
}

/** Every match as [start, end]; empty matches are skipped so the search always moves on. */
export function findAll(text: string, re: RegExp, limit = MAX_MATCHES): [number, number][] {
  const out: [number, number][] = []
  re.lastIndex = 0
  for (let m = re.exec(text); m && out.length < limit; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    out.push([m.index, m.index + m[0].length])
  }
  return out
}

/**
 * The text the match at [start, end) is replaced with. In regex mode `$1` style groups work;
 * the match is re-run in place so anchors and lookarounds see the whole text.
 */
export function replacement(text: string, start: number, end: number, re: RegExp, replace: string, regex: boolean): string {
  if (!regex) return replace
  const here = new RegExp(re.source, re.flags.replace('g', '') + 'y')
  here.lastIndex = start
  const out = text.replace(here, replace)
  return out.slice(start, out.length - (text.length - end))
}

/** Replaces every match; returns the new text and how many were replaced. */
export function replaceAll(text: string, re: RegExp, replace: string, regex: boolean): { text: string; count: number } {
  re.lastIndex = 0
  const count = [...text.matchAll(re)].length
  return { text: regex ? text.replace(re, replace) : text.replace(re, () => replace), count }
}

/** 1-based line and column of an offset. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1
  let start = 0
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++
    start = i + 1
  }
  return { line, col: offset - start + 1 }
}

/** Offset where a 1-based line starts (clamped to the text). */
export function lineStart(text: string, line: number): number {
  let at = 0
  for (let n = 1; n < line; n++) {
    const i = text.indexOf('\n', at)
    if (i === -1) return at
    at = i + 1
  }
  return at
}

export function countLines(text: string): number {
  let n = 1
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++
  return n
}

/** The indentation the file mostly uses: a tab, or 2 or 4 spaces. */
export function detectIndent(text: string): string {
  let tabs = 0
  let two = 0
  let four = 0
  for (const m of text.slice(0, 200_000).matchAll(/^([ \t]+)\S/gm)) {
    const ws = m[1]
    if (ws[0] === '\t') tabs++
    else if (ws.length % 4 === 0) four++
    else if (ws.length % 2 === 0) two++
  }
  if (tabs > two + four) return '\t'
  return two > four ? '  ' : four > 0 ? '    ' : '  '
}

export class JsonError extends Error {
  constructor(message: string, readonly offset: number | null) {
    super(message)
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    const msg = (e as Error).message
    const pos = /position (\d+)/.exec(msg)
    let offset = pos ? Number(pos[1]) : null
    const lc = /line (\d+) column (\d+)/.exec(msg)
    if (offset === null && lc) offset = lineStart(text, Number(lc[1])) + Number(lc[2]) - 1
    const where = offset === null ? '' : (({ line, col }) => ` (line ${line}, column ${col})`)(lineCol(text, offset))
    throw new JsonError(`Not valid JSON: ${msg.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '')}${where}`, offset)
  }
}

/** Pretty-prints JSON; throws JsonError pointing at the problem when it is not valid. */
export const formatJson = (text: string, indent: string | number = 2): string => JSON.stringify(parseJson(text), null, indent) + (text.endsWith('\n') ? '\n' : '')
export const minifyJson = (text: string): string => JSON.stringify(parseJson(text))

/** Transforms that work on whole lines (the selected ones, or every line). */
export type LineOp = 'sort' | 'sortDesc' | 'unique' | 'trim' | 'removeEmpty' | 'reverse'

export function applyLineOp(lines: string[], op: LineOp): string[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  switch (op) {
    case 'sort':
      return [...lines].sort(collator.compare)
    case 'sortDesc':
      return [...lines].sort((a, b) => collator.compare(b, a))
    case 'unique':
      return lines.filter((l, i) => lines.indexOf(l) === i)
    case 'trim':
      return lines.map((l) => l.replace(/[ \t]+$/, ''))
    case 'removeEmpty':
      return lines.filter((l) => l.trim() !== '')
    case 'reverse':
      return [...lines].reverse()
  }
}

/** Line comment marker for a file name, if its language has one. */
export function lineComment(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (/^(js|jsx|ts|tsx|mjs|cjs|c|h|cpp|hpp|cc|cs|java|kt|kts|go|rs|swift|scala|dart|php|jsonc|groovy|gradle|zig|v|sol|css|scss|less)$/.test(ext)) return '//'
  if (/^(py|rb|sh|bash|zsh|ps1|psm1|yml|yaml|toml|ini|conf|cfg|r|pl|pm|tcl|mk|makefile|dockerfile|gitignore|gitattributes|env|properties|nim|cr|ex|exs|coffee)$/.test(ext)) return '#'
  if (/^(sql|lua|hs|elm|ada)$/.test(ext)) return '--'
  if (/^(bat|cmd)$/.test(ext)) return 'REM'
  if (/^(vb|vbs)$/.test(ext)) return "'"
  if (/^(lisp|clj|cljs|el|scm|asm|s)$/.test(ext)) return ';'
  if (/^(tex|erl|m)$/.test(ext)) return '%'
  return null
}

const LANGS: [RegExp, string][] = [
  [/\.(ts|mts|cts)$/, 'TypeScript'],
  [/\.tsx$/, 'TypeScript JSX'],
  [/\.(js|mjs|cjs)$/, 'JavaScript'],
  [/\.jsx$/, 'JavaScript JSX'],
  [/\.jsonc?$/, 'JSON'],
  [/\.(md|markdown)$/, 'Markdown'],
  [/\.(html?|xhtml)$/, 'HTML'],
  [/\.(xml|xaml|csproj|props|targets|svg|plist)$/, 'XML'],
  [/\.css$/, 'CSS'],
  [/\.(scss|sass)$/, 'Sass'],
  [/\.py$/, 'Python'],
  [/\.rb$/, 'Ruby'],
  [/\.go$/, 'Go'],
  [/\.rs$/, 'Rust'],
  [/\.java$/, 'Java'],
  [/\.(kt|kts)$/, 'Kotlin'],
  [/\.cs$/, 'C#'],
  [/\.(c|h)$/, 'C'],
  [/\.(cpp|hpp|cc|cxx)$/, 'C++'],
  [/\.php$/, 'PHP'],
  [/\.swift$/, 'Swift'],
  [/\.(sh|bash|zsh)$/, 'Shell'],
  [/\.(ps1|psm1)$/, 'PowerShell'],
  [/\.(bat|cmd)$/, 'Batch'],
  [/\.(yml|yaml)$/, 'YAML'],
  [/\.toml$/, 'TOML'],
  [/\.(ini|cfg|conf)$/, 'INI'],
  [/\.sql$/, 'SQL'],
  [/\.lua$/, 'Lua'],
  [/(^|[\\/])dockerfile$/, 'Dockerfile'],
  [/(^|[\\/])makefile$/, 'Makefile'],
  [/\.txt$/, 'Plain text']
]

export function languageOf(path: string): string {
  const p = path.toLowerCase()
  return LANGS.find(([re]) => re.test(p))?.[1] ?? 'Plain text'
}
