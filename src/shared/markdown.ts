/**
 * A small markdown reader for the editor's preview: CommonMark blocks and inlines plus the GitHub
 * extras (tables, task lists, strikethrough, bare links, alerts). It builds a tree, never HTML, so
 * nothing in a file runs as markup: HTML tags are dropped and their text kept, except for images,
 * links and line breaks, which become the same nodes markdown makes.
 */

export type Inline =
  | string
  | { t: 'em' | 'strong' | 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; title?: string; c: Inline[] }
  | { t: 'img'; src: string; alt: string; title?: string }
  | { t: 'br' }

export type Align = 'left' | 'center' | 'right' | null

/** `line` is the 0-based source line the item starts on. */
export interface ListItem {
  line: number
  task: boolean | null
  c: Block[]
}

/** `line` is the 0-based source line the block starts on, for scrolling the preview with the text. */
export type Block = { line: number } & (
  | { t: 'h'; level: number; id: string; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; alert: string | null; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { t: 'hr' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
)

interface Ctx {
  refs: Map<string, { href: string; title?: string }>
  slugs: Map<string, number>
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)[ \t]*(.*?)(?:[ \t]+#+)?[ \t]*$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
const BULLET = /^( {0,3})([-*+])([ \t]+|$)/
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/
const HTML = /^ {0,3}<(?:[a-zA-Z][\w-]*(?:[\s/>]|$)|\/[a-zA-Z][\w-]*\s*>|!--)/
const DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/
const DELIM_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i

const blank = (l: string) => !l.trim()
const indentOf = (l: string) => /^ */.exec(l)![0].length
const normLabel = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

interface Marker {
  ordered: boolean
  char: string
  start: number
  indent: number
  rest: string
}

function listMarker(l: string): Marker | null {
  const b = BULLET.exec(l)
  const o = b ? null : ORDERED.exec(l)
  const m = b ?? o
  if (!m) return null
  const head = b ? m[1].length + 1 : m[1].length + m[2].length + 1
  const space = b ? m[3] : m[4]
  const indent = !space || space.length > 4 || l.length === head + space.length ? head + 1 : head + space.length
  return { ordered: !!o, char: b ? m[2] : m[3], start: o ? Number(m[2]) : 1, indent, rest: l.slice(Math.min(indent, l.length)) }
}

/** Whether a line starts a block that can cut a paragraph short. */
function interrupts(l: string): boolean {
  if (ATX.test(l) || FENCE.test(l) || HR.test(l) || QUOTE.test(l) || HTML.test(l)) return true
  const m = listMarker(l)
  return !!m && !blank(m.rest) && (!m.ordered || m.start === 1)
}

function splitRow(l: string): string[] {
  let s = l.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

function parseBlocks(lines: string[], first: number, ctx: Ctx): Block[] {
  const out: Block[] = []
  const n = lines.length
  let i = 0
  while (i < n) {
    const l = lines[i]
    const line = first + i
    if (blank(l)) {
      i++
      continue
    }

    const f = FENCE.exec(l)
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) {
      const close = new RegExp(`^ {0,3}${f[2][0] === '`' ? '`' : '~'}{${f[2].length},}[ \\t]*$`)
      const body: string[] = []
      let j = i + 1
      while (j < n && !close.test(lines[j])) body.push(lines[j++].replace(new RegExp(`^ {0,${f[1].length}}`), ''))
      out.push({ line, t: 'code', lang: f[3].trim().split(/\s+/)[0] ?? '', v: body.join('\n') })
      i = j + 1
      continue
    }

    const h = ATX.exec(l)
    if (h) {
      out.push(heading(line, h[1].length, h[2], ctx))
      i++
      continue
    }

    if (HR.test(l)) {
      out.push({ line, t: 'hr' })
      i++
      continue
    }

    if (QUOTE.test(l)) {
      const body: string[] = []
      let j = i
      while (j < n) {
        const q = lines[j]
        if (QUOTE.test(q)) body.push(q.replace(QUOTE, ''))
        else if (!blank(q) && body.length && !blank(body[body.length - 1]) && !interrupts(q)) body.push(q)
        else break
        j++
      }
      const c = parseBlocks(body, line, ctx)
      let alert: string | null = null
      const p = c[0]
      if (p?.t === 'p' && typeof p.c[0] === 'string') {
        const a = ALERT.exec(p.c[0])
        if (a) {
          alert = a[1].toLowerCase()
          p.c = [p.c[0].slice(a[0].length), ...p.c.slice(1)].filter((x) => x !== '')
          if (!p.c.length) c.shift()
        }
      }
      out.push({ line, t: 'quote', alert, c })
      i = j
      continue
    }

    const lm = listMarker(l)
    if (lm) {
      const items: ListItem[] = []
      let tight = true
      let j = i
      while (j < n) {
        const m = listMarker(lines[j])
        if (!m || m.ordered !== lm.ordered || m.char !== lm.char) break
        const start = j
        const body = [m.rest]
        j++
        while (j < n) {
          const x = lines[j]
          if (blank(x)) body.push('')
          else if (indentOf(x) >= m.indent) body.push(x.slice(m.indent))
          // A lazy line carries on the paragraph above it.
          else if (!blank(body[body.length - 1]) && !interrupts(x) && !listMarker(x) && !SETEXT.test(x)) body.push(x)
          else break
          j++
        }
        let end = body.length
        while (end > 1 && blank(body[end - 1])) end--
        if (end < body.length && j < n && listMarker(lines[j])) tight = false
        const content = body.slice(0, end)
        if (content.slice(1).some(blank) && !content.some((x) => FENCE.test(x))) tight = false
        const task = /^\[([ xX])\][ \t]+/.exec(content[0])
        if (task) content[0] = content[0].slice(task[0].length)
        items.push({ line: first + start, task: task ? task[1] !== ' ' : null, c: parseBlocks(content, first + start, ctx) })
      }
      out.push({ line, t: 'list', ordered: lm.ordered, start: lm.start, tight, items })
      i = j
      continue
    }

    if (/^ {4}/.test(l)) {
      const body: string[] = []
      let j = i
      while (j < n && (blank(lines[j]) || /^ {4}/.test(lines[j]))) body.push(lines[j++].slice(4))
      while (body.length && blank(body[body.length - 1])) body.pop()
      out.push({ line, t: 'code', lang: '', v: body.join('\n') })
      i = j
      continue
    }

    if (l.includes('|') && i + 1 < n && DELIM_ROW.test(lines[i + 1])) {
      const head = splitRow(l)
      const delims = splitRow(lines[i + 1])
      if (head.length === delims.length) {
        const align = delims.map<Align>((d) => (d.startsWith(':') ? (d.endsWith(':') ? 'center' : 'left') : d.endsWith(':') ? 'right' : null))
        const rows: Inline[][][] = []
        let j = i + 2
        while (j < n && !blank(lines[j]) && !interrupts(lines[j])) {
          const cells = splitRow(lines[j++])
          rows.push(head.map((_, k) => parseInline(cells[k] ?? '', ctx)))
        }
        out.push({ line, t: 'table', align, head: head.map((c) => parseInline(c, ctx)), rows })
        i = j
        continue
      }
    }

    if (DEF.test(l)) {
      i++
      continue
    }

    // A paragraph, or a heading underlined with = or -. An HTML block reads as one too.
    const html = HTML.test(l)
    const body = [l]
    let j = i + 1
    while (j < n && !blank(lines[j])) {
      if (!html && (SETEXT.test(lines[j]) || interrupts(lines[j]))) break
      body.push(lines[j++])
    }
    const text = body.map((x) => x.trimStart()).join('\n').trimEnd()
    const s = !html && j < n ? SETEXT.exec(lines[j]) : null
    if (s) {
      out.push(heading(line, s[1][0] === '=' ? 1 : 2, text, ctx))
      j++
    } else {
      const c = parseInline(text, ctx)
      if (c.some((x) => typeof x !== 'string' || x.trim())) out.push({ line, t: 'p', c })
    }
    i = j
  }
  return out
}

function heading(line: number, level: number, raw: string, ctx: Ctx): Block {
  const c = parseInline(raw, ctx)
  const base = plainText(c).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-')
  const seen = ctx.slugs.get(base) ?? 0
  ctx.slugs.set(base, seen + 1)
  return { line, t: 'h', level, id: seen ? `${base}-${seen}` : base, c }
}

/** The text of inlines without their formatting, for anchors and image descriptions. */
export function plainText(c: Inline[]): string {
  return c
    .map((x) => (typeof x === 'string' ? x : x.t === 'code' ? x.v : x.t === 'img' ? x.alt : x.t === 'br' ? ' ' : plainText(x.c)))
    .join('')
}

// ------------------------------------------------------------ inlines

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', larr: '←', rarr: '→', uarr: '↑', darr: '↓', times: '×', middot: '·', bull: '•'
}
const decode = (s: string) =>
  s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
  })

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)
const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined)

/** The end of a code span starting at `i`, or -1. */
function codeEnd(s: string, i: number): number {
  let k = i
  while (s[k] === '`') k++
  const run = k - i
  for (let j = s.indexOf('`', k); j !== -1; j = s.indexOf('`', j)) {
    let e = j
    while (s[e] === '`') e++
    if (e - j === run) return e
    j = e
  }
  return -1
}

/** Where an emphasis run of `len` `ch` characters closes, searching from `from`, or -1. */
function closer(s: string, from: number, ch: string, len: number): number {
  for (let j = from; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') j++
    else if (c === '`') {
      const e = codeEnd(s, j)
      if (e !== -1) j = e - 1
    } else if (c === ch) {
      let e = j
      while (s[e] === ch) e++
      const run = e - j
      const ok = run >= len && !isSpace(s[j - 1]) && (ch !== '_' || !isWord(s[e]))
      // A run of two inside single emphasis is a nested strong, not the close.
      if (ok && !(len === 1 && run === 2)) return e - len
      j = e - 1
    }
  }
  return -1
}

/** The index of the `]` matching the `[` at `i`, or -1. */
function bracketEnd(s: string, i: number): number {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') j++
    else if (c === '`') {
      const e = codeEnd(s, j)
      if (e !== -1) j = e - 1
    } else if (c === '[') depth++
    else if (c === ']' && --depth === 0) return j
  }
  return -1
}

/** A link destination and title in `(...)` starting at `i`: the pieces and the index after `)`. */
function destination(s: string, i: number): { href: string; title?: string; end: number } | null {
  let j = i + 1
  while (s[j] === ' ' || s[j] === '\n') j++
  let href = ''
  if (s[j] === '<') {
    const e = s.indexOf('>', j)
    if (e === -1) return null
    href = s.slice(j + 1, e)
    j = e + 1
  } else {
    let depth = 0
    const st = j
    for (; j < s.length && !/\s/.test(s[j]); j++) {
      if (s[j] === '\\') j++
      else if (s[j] === '(') depth++
      else if (s[j] === ')' && depth-- === 0) break
    }
    href = s.slice(st, j)
  }
  while (s[j] === ' ' || s[j] === '\n') j++
  let title: string | undefined
  const q = s[j]
  if (q === '"' || q === "'" || q === '(') {
    const e = s.indexOf(q === '(' ? ')' : q, j + 1)
    if (e === -1) return null
    title = decode(s.slice(j + 1, e))
    j = e + 1
    while (s[j] === ' ' || s[j] === '\n') j++
  }
  if (s[j] !== ')') return null
  return { href: decode(href.replace(/\\(.)/g, '$1')), title, end: j + 1 }
}

export function parseInline(src: string, ctx: Ctx): Inline[] {
  const s = src.replace(/<!--[\s\S]*?-->/g, '')
  const out: Inline[] = []
  let txt = ''
  const flush = () => {
    if (txt) out.push(decode(txt))
    txt = ''
  }
  const push = (x: Inline) => {
    flush()
    out.push(x)
  }

  for (let i = 0; i < s.length; ) {
    const c = s[i]

    if (c === '\\') {
      if (s[i + 1] === '\n') {
        push({ t: 'br' })
        i += 2
      } else if (s[i + 1] && PUNCT.test(s[i + 1])) {
        // Kept apart from entity decoding, so \&amp; stays as written.
        flush()
        out.push(s[i + 1])
        i += 2
      } else {
        txt += c
        i++
      }
      continue
    }

    if (c === '`') {
      const e = codeEnd(s, i)
      let k = i
      while (s[k] === '`') k++
      if (e === -1) {
        txt += s.slice(i, k)
        i = k
        continue
      }
      let v = s.slice(k, e - (k - i)).replace(/\n/g, ' ')
      if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1)
      push({ t: 'code', v })
      i = e
      continue
    }

    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const img = c === '!'
      const open = img ? i + 1 : i
      const close = bracketEnd(s, open)
      if (close !== -1) {
        const label = s.slice(open + 1, close)
        let target: { href: string; title?: string } | undefined
        let end = close + 1
        if (s[close + 1] === '(') {
          const d = destination(s, close + 1)
          if (d) {
            target = d
            end = d.end
          }
        } else if (s[close + 1] === '[') {
          const e = s.indexOf(']', close + 2)
          if (e !== -1) {
            target = ctx.refs.get(normLabel(s.slice(close + 2, e) || label))
            end = e + 1
          }
        } else target = ctx.refs.get(normLabel(label))
        if (target) {
          const inner = parseInline(label, ctx)
          push(img ? { t: 'img', src: target.href, alt: plainText(inner), title: target.title } : { t: 'link', href: target.href, title: target.title, c: inner })
          i = end
          continue
        }
      }
      txt += c
      i++
      continue
    }

    if (c === '<') {
      const rest = s.slice(i)
      const auto = /^<((?:https?|ftp):\/\/[^\s<>]*|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/i.exec(rest)
      if (auto) {
        push({ t: 'link', href: auto[1].includes('@') && !auto[1].includes('://') ? `mailto:${auto[1]}` : auto[1], c: [auto[1]] })
        i += auto[0].length
        continue
      }
      const a = /^<a\b[^>]*>([\s\S]*?)<\/a\s*>/i.exec(rest)
      if (a) {
        const href = attr(a[0].slice(0, a[0].indexOf('>') + 1), 'href')
        const inner = parseInline(a[1], ctx)
        if (href) push({ t: 'link', href: decode(href), c: inner })
        else (flush(), out.push(...inner))
        i += a[0].length
        continue
      }
      const tag = /^<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/.exec(rest)
      if (tag) {
        const name = /^<\/?([a-zA-Z][\w-]*)/.exec(tag[0])![1].toLowerCase()
        if (name === 'br') push({ t: 'br' })
        else if (name === 'img') {
          const src = attr(tag[0], 'src')
          if (src) push({ t: 'img', src: decode(src), alt: decode(attr(tag[0], 'alt') ?? ''), title: attr(tag[0], 'title') })
        }
        i += tag[0].length
        continue
      }
    }

    if (c === '*' || c === '_') {
      let k = i
      while (s[k] === c) k++
      const run = k - i
      const opens = !isSpace(s[k]) && (c !== '_' || !isWord(s[i - 1]))
      if (opens) {
        if (run >= 2) {
          const e = closer(s, i + 2, c, 2)
          if (e > i + 2) {
            push({ t: 'strong', c: parseInline(s.slice(i + 2, e), ctx) })
            i = e + 2
            continue
          }
        }
        const e = closer(s, i + 1, c, 1)
        if (e > i + 1) {
          push({ t: 'em', c: parseInline(s.slice(i + 1, e), ctx) })
          i = e + 1
          continue
        }
      }
      txt += s.slice(i, k)
      i = k
      continue
    }

    if (c === '~') {
      let k = i
      while (s[k] === '~') k++
      const run = k - i
      if (run <= 2 && !isSpace(s[k])) {
        const e = s.indexOf('~'.repeat(run), k)
        if (e > k && s[e + run] !== '~' && !isSpace(s[e - 1])) {
          push({ t: 'del', c: parseInline(s.slice(k, e), ctx) })
          i = e + run
          continue
        }
      }
      txt += s.slice(i, k)
      i = k
      continue
    }

    if ((c === 'h' || c === 'w') && !isWord(s[i - 1])) {
      const m = /^(?:https?:\/\/|www\.)[^\s<]+/.exec(s.slice(i, i + 2048))
      if (m) {
        let url = m[0].replace(/[?!.,:;*_~'"]+$/, '')
        // A closing parenthesis ends the link unless the link opened one.
        while (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1).replace(/[?!.,:;*_~'"]+$/, '')
        if (url.length > 7) {
          push({ t: 'link', href: url.startsWith('www.') ? `https://${url}` : url, c: [url] })
          i += url.length
          continue
        }
      }
    }

    if (c === '\n') {
      if (/ {2,}$/.test(txt)) {
        txt = txt.replace(/ +$/, '')
        push({ t: 'br' })
      } else txt = txt.replace(/ +$/, '') + '\n'
      i++
      continue
    }

    txt += c
    i++
  }
  flush()
  return out
}

// ------------------------------------------------------------ document

/** Reads a markdown document into blocks. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)))
  const ctx: Ctx = { refs: new Map(), slugs: new Map() }
  // Reference definitions can be used above where they are written, so they are gathered first.
  let fence: RegExp | null = null
  for (const l of lines) {
    if (fence) {
      if (fence.test(l)) fence = null
      continue
    }
    const f = FENCE.exec(l)
    if (f) fence = new RegExp(`^ {0,3}${f[2][0] === '`' ? '`' : '~'}{${f[2].length},}[ \\t]*$`)
    const d = DEF.exec(l)
    if (d && !ctx.refs.has(normLabel(d[1]))) ctx.refs.set(normLabel(d[1]), { href: d[2], title: d[3] ?? d[4] ?? d[5] })
  }
  return parseBlocks(lines, 0, ctx)
}

const MARKDOWN = /\.(md|markdown|mdown|mkd|mkdn|mdx)$/i

export const isMarkdownPath = (p: string) => MARKDOWN.test(p)
