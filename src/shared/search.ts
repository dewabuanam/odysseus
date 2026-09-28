// Commit search query language:
//   author:"sam" branch:master after:"2 weeks ago" path:src/app.ts fix login
// Keys narrow the search; bare words are matched against commit messages (and hashes).

export interface SearchQuery {
  /** Bare words: all must appear in the message (or the word is a commit hash prefix) */
  text: string[]
  author?: string
  committer?: string
  after?: string
  before?: string
  branch?: string
  paths: string[]
  message: string[]
  /** Pickaxe: commits whose diff adds/removes lines matching this regex */
  contents?: string
  /** Pickaxe: commits that change the number of occurrences of this exact string */
  string?: string
  /** Treat message words as extended regular expressions */
  regex: string[]
  maxParents?: number
  minParents?: number
  firstParent?: boolean
  /** Maximum number of results */
  limit?: number
}

export interface SearchKey {
  key: string
  description: string
  /** Example values offered by autocomplete */
  examples?: { value: string; detail: string }[]
}

export const SEARCH_KEYS: SearchKey[] = [
  { key: 'author', description: 'author name or email contains', examples: [{ value: 'me', detail: 'your own commits (user.email)' }] },
  { key: 'committer', description: 'committer name or email contains' },
  {
    key: 'after',
    description: 'committed after a date',
    examples: [
      { value: 'yesterday', detail: 'since yesterday' },
      { value: '1 week ago', detail: 'last 7 days' },
      { value: '1 month ago', detail: 'last month' },
      { value: '2026-01-01', detail: 'an exact date' }
    ]
  },
  {
    key: 'before',
    description: 'committed before a date',
    examples: [
      { value: '1 week ago', detail: 'older than a week' },
      { value: '2026-01-01', detail: 'an exact date' }
    ]
  },
  {
    key: 'date',
    description: 'committed on a day',
    examples: [
      { value: 'today', detail: 'today' },
      { value: 'yesterday', detail: 'yesterday' },
      { value: '2026-01-01', detail: 'an exact day' }
    ]
  },
  { key: 'path', description: 'touches this file or folder' },
  { key: 'ext', description: 'touches files with this extension', examples: [{ value: 'ts', detail: '*.ts files' }, { value: 'vue', detail: '*.vue files' }] },
  { key: 'branch', description: 'reachable from this branch, tag or commit' },
  { key: 'tag', description: 'reachable from this tag' },
  { key: 'message', description: 'message contains (same as bare words)' },
  { key: 'regex', description: 'message matches a regular expression', examples: [{ value: '^(feat|fix)', detail: 'conventional commits' }, { value: '[A-Z]+-[0-9]+', detail: 'ticket ids' }] },
  { key: 'hash', description: 'commit hash starts with' },
  { key: 'contents', description: 'diff adds or removes lines matching (regex)' },
  { key: 'string', description: 'diff changes how often this exact text appears' },
  {
    key: 'merges',
    description: 'merge commits',
    examples: [
      { value: 'only', detail: 'only merge commits' },
      { value: 'none', detail: 'hide merge commits' }
    ]
  },
  { key: 'first-parent', description: 'follow only the first parent (mainline)', examples: [{ value: 'yes', detail: 'mainline history' }] },
  {
    key: 'limit',
    description: 'maximum results (default 10000)',
    examples: [
      { value: '100', detail: 'latest 100' },
      { value: '50000', detail: 'very large histories' }
    ]
  },
  {
    key: 'max-parents',
    description: 'at most N parents',
    examples: [
      { value: '1', detail: 'no merge commits' },
      { value: '0', detail: 'root commits only' }
    ]
  },
  { key: 'min-parents', description: 'at least N parents', examples: [{ value: '2', detail: 'merge commits only' }] }
]

const KEY_NAMES = new Set(SEARCH_KEYS.map((k) => k.key).concat(['file', 'since', 'until', 'on', 'in', 'ref', 'grep']))

/** Splits into tokens, keeping quoted values together: author:"John Smith" -> one token. */
export function tokenize(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of input) {
    if (ch === '"') {
      quoted = !quoted
      cur += ch
    } else if (/\s/.test(ch) && !quoted) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

const unquote = (v: string) => v.replace(/^"(.*)"?$/, '$1').replace(/"$/, '')

export function parseSearch(input: string): SearchQuery {
  const q: SearchQuery = { text: [], paths: [], message: [], regex: [] }
  for (const tok of tokenize(input)) {
    const m = tok.match(/^([a-z-]+):(.*)$/i)
    const key = m?.[1].toLowerCase()
    if (!m || !key || !KEY_NAMES.has(key)) {
      const t = unquote(tok)
      if (t) q.text.push(t)
      continue
    }
    const value = unquote(m[2])
    if (!value) continue
    switch (key) {
      case 'author': q.author = value; break
      case 'committer': q.committer = value; break
      case 'after': case 'since': q.after = value; break
      case 'before': case 'until': q.before = value; break
      case 'branch': case 'tag': case 'in': case 'ref': q.branch = value; break
      case 'date': case 'on': {
        // A whole day: from its midnight to the next.
        q.after = `${value} 00:00:00`
        q.before = `${value} 23:59:59`
        break
      }
      case 'ext': q.paths.push(`:(glob)**/*.${value.replace(/^\*?\.?/, '')}`); break
      case 'regex': case 'grep': q.regex.push(value); break
      case 'string': q.string = value; break
      case 'merges':
        if (/^(only|yes|true)$/i.test(value)) q.minParents = 2
        else if (/^(none|no|false|hide)$/i.test(value)) q.maxParents = 1
        break
      case 'first-parent': q.firstParent = !/^(no|false|0)$/i.test(value); break
      case 'limit': if (/^\d+$/.test(value)) q.limit = Number(value); break
      case 'path': case 'file': q.paths.push(value); break
      case 'message': q.message.push(value); break
      case 'hash': q.text.push(value); break
      case 'contents': q.contents = value; break
      case 'max-parents': if (/^\d+$/.test(value)) q.maxParents = Number(value); break
      case 'min-parents': if (/^\d+$/.test(value)) q.minParents = Number(value); break
    }
  }
  return q
}

export function isEmptyQuery(q: SearchQuery): boolean {
  return !q.text.length && !q.paths.length && !q.message.length && !q.regex.length && !q.string && !q.firstParent && !q.author && !q.committer && !q.after && !q.before && !q.branch && !q.contents && q.maxParents === undefined && q.minParents === undefined
}
