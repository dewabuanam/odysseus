import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

// ------------------------------------------------------------------ model

export interface Cmd {
  id: string
  title: string
  detail?: string
  /** Shortcut in "Mod+Shift+P" form. Mod = Ctrl on Windows/Linux, Cmd on macOS. */
  keys?: string
  /** Hidden from the palette and shortcuts when false. */
  when?: boolean
  /** The git command this option runs, shown on the right. */
  cmdline?: string
  run(): void | Step | Promise<void | Step>
}

export interface Suggestion {
  value: string
  detail?: string
}

export type Step =
  | { kind: 'list'; placeholder: string; items: Cmd[]; title?: string }
  | {
      kind: 'input'
      placeholder: string
      /** Pre-filled value */
      value?: string
      title?: string
      /** Options shown under the input; arrow keys fill them in */
      suggestions?: Suggestion[]
      allowEmpty?: boolean
      submit(value: string): void | Step | Promise<void | Step>
    }

const isMac = navigator.userAgent.includes('Mac')

export function formatKeys(keys: string): string {
  if (keys === 'Shift Shift') return isMac ? '⇧⇧' : 'Shift Shift'
  if (keys.includes(' ')) return keys.split(' ').map(formatKeys).join(' ')
  return keys
    .split('+')
    .map((k) => (k === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : k === 'Shift' && isMac ? '⇧' : k === 'Alt' && isMac ? '⌥' : k))
    .join(isMac ? '' : '+')
}

export function matchesKeys(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const mod = parts.includes('Mod')
  if (mod !== (isMac ? e.metaKey : e.ctrlKey)) return false
  if (parts.includes('Shift') !== e.shiftKey) return false
  if (parts.includes('Alt') !== e.altKey) return false
  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  if (pressed === key) return true
  // Shift changes e.key for symbols/letters; fall back to the physical key.
  return e.code.toLowerCase() === `key${key}` || e.code.toLowerCase() === `digit${key}` || (key === '`' && e.code === 'Backquote')
}

// ------------------------------------------------------------------ fuzzy

const isBoundary = (t: string, i: number) => i === 0 || /[\s:/._()-]/.test(t[i - 1])

/**
 * Fuzzy subsequence match. Tries an alignment starting at every candidate position
 * for the first character and keeps the best: word starts and consecutive runs score high,
 * matches scattered across the string score low.
 */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return { score: 0, hits: [] }
  const t = text.toLowerCase()
  let best: { score: number; hits: number[] } | null = null
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const hits = [start]
    let score = 1 + (isBoundary(t, start) ? 8 : 0)
    let ok = true
    for (let qi = 1; qi < q.length; qi++) {
      const prev = hits[hits.length - 1]
      let found = -1
      if (t[prev + 1] === q[qi]) found = prev + 1
      else {
        for (let j = prev + 1; j < t.length; j++) {
          if (t[j] === q[qi] && isBoundary(t, j)) {
            found = j
            break
          }
        }
        if (found === -1) found = t.indexOf(q[qi], prev + 1)
      }
      if (found === -1) {
        ok = false
        break
      }
      score += 1 + (found === prev + 1 ? 6 : 0) + (isBoundary(t, found) ? 8 : 0)
      hits.push(found)
    }
    if (!ok) break
    const span = hits[hits.length - 1] - hits[0] + 1
    score -= (span - q.length) * 0.6 + hits[0] * 0.05 + t.length * 0.01
    if (!best || score > best.score) best = { score, hits }
  }
  return best
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>
  const set = new Set(hits)
  const out: React.ReactNode[] = []
  let buf = ''
  let on = false
  for (let i = 0; i < text.length; i++) {
    const h = set.has(i)
    if (h !== on && buf) {
      out.push(on ? <b key={i}>{buf}</b> : buf)
      buf = ''
    }
    on = h
    buf += text[i]
  }
  if (buf) out.push(on ? <b key="end">{buf}</b> : buf)
  return <>{out}</>
}

// ------------------------------------------------------------------ recents

// ------------------------------------------------------------------ usage ranking

/**
 * "Frecency": how often and how recently each item was chosen. Keyed per step, so the push
 * option or branch you pick most rises to the top of that list, not just top-level commands.
 */
const USAGE_KEY = 'odysseus.palette.usage'
type Usage = Record<string, { n: number; t: number }>
let usageCache: Usage | null = null

function loadUsage(): Usage {
  if (usageCache) return usageCache
  try {
    usageCache = JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}')
  } catch {
    usageCache = {}
  }
  return usageCache!
}

export function recordUsage(key: string) {
  const u = loadUsage()
  const e = u[key] ?? { n: 0, t: 0 }
  u[key] = { n: e.n + 1, t: Date.now() }
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u))
  } catch {
    /* storage unavailable */
  }
}

export function usageScore(key: string): number {
  const e = loadUsage()[key]
  if (!e) return 0
  const days = (Date.now() - e.t) / 86_400_000
  const recency = days < 1 ? 4 : days < 7 ? 2 : days < 30 ? 1 : 0.5
  return Math.log2(1 + e.n) * 3 + recency
}

// ------------------------------------------------------------------ component

const MAX_RENDERED = 150

const crumbOf = (s: string) => s.replace(/…$/, '').replace(/^[^:]+:\s*/, '')

export function Palette({ initial, onClose }: { initial: Step; onClose(): void }) {
  const [stack, setStack] = useState<{ step: Step; crumb?: string }[]>([{ step: initial, crumb: initial.title }])
  // `query` is what the input shows; `typed` is what the user actually typed. Arrow keys fill
  // the input with a suggestion without changing which suggestions are listed.
  const [query, setQuery] = useState(initial.kind === 'input' ? initial.value ?? '' : '')
  const [typed, setTyped] = useState('')
  const [active, setActive] = useState(initial.kind === 'input' ? -1 : 0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { step } = stack[stack.length - 1]
  const isRoot = stack.length === 1
  const crumbs = stack.map((s) => s.crumb).filter(Boolean) as string[]

  const scope = crumbs.join(' › ') || 'root'
  const usageKey = (c: Cmd) => `${scope}|${c.id}`

  const results = useMemo(() => {
    if (step.kind !== 'list') return []
    const items = step.items.filter((c) => c.when !== false)
    if (!typed.trim()) {
      // Most-used first; ties keep the list's own order (stable sort).
      return items
        .map((c, i) => ({ c, hits: [] as number[], u: usageScore(usageKey(c)), i }))
        .sort((a, b) => b.u - a.u || a.i - b.i)
    }
    const scored: { c: Cmd; hits: number[]; score: number }[] = []
    for (const c of items) {
      const bonus = Math.min(usageScore(usageKey(c)), 12)
      const m = fuzzy(typed, c.title)
      if (m) scored.push({ c, hits: m.hits, score: m.score + bonus })
      else {
        const d = fuzzy(typed, `${c.detail ?? ''} ${c.cmdline ?? ''}`)
        if (d) scored.push({ c, hits: [], score: d.score - 5 + bonus })
      }
    }
    return scored.sort((a, b) => b.score - a.score)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, typed, scope])

  const suggestions = useMemo(() => {
    if (step.kind !== 'input' || !step.suggestions) return []
    if (!typed.trim()) return step.suggestions
    return step.suggestions
      .map((s) => ({ s, m: fuzzy(typed, s.value) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .map((x) => x.s)
  }, [step, typed])

  const count = step.kind === 'list' ? Math.min(results.length, MAX_RENDERED) : suggestions.length

  useEffect(() => inputRef.current?.focus(), [step])
  useLayoutEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const reset = (s: Step) => {
    setQuery(s.kind === 'input' ? s.value ?? '' : '')
    setTyped('')
    setActive(s.kind === 'input' ? -1 : 0)
  }

  const advance = async (next: void | Step | Promise<void | Step>, crumb?: string) => {
    setBusy(true)
    try {
      const r = await next
      if (r && typeof r === 'object' && (r.kind === 'list' || r.kind === 'input')) {
        setStack((s) => [...s, { step: r, crumb: r.title ?? crumb }])
        reset(r)
      } else onClose()
    } catch (e) {
      console.error(e)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const choose = (c: Cmd) => {
    recordUsage(usageKey(c))
    advance(c.run(), crumbOf(c.title))
  }

  const back = () => {
    const prev = stack[stack.length - 2]
    setStack((s) => s.slice(0, -1))
    reset(prev.step)
  }

  const fill = (v: string) => {
    setQuery(v)
    setTyped(v)
    inputRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    const move = (delta: number) => {
      e.preventDefault()
      if (!count) return
      const floor = step.kind === 'input' ? -1 : 0
      const next = Math.max(floor, Math.min(count - 1, active + delta))
      setActive(next)
      // Input steps: moving onto a suggestion fills the input with it.
      if (step.kind === 'input') setQuery(next === -1 ? typed || (step.value ?? '') : suggestions[next].value)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && !query && stack.length > 1) {
      e.preventDefault()
      back()
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) move(1)
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) move(-1)
    else if (e.key === 'PageDown') move(10)
    else if (e.key === 'PageUp') move(-10)
    else if (e.key === 'Tab') {
      // Tab completes the input with the highlighted option (or the first one).
      e.preventDefault()
      if (step.kind === 'list') {
        const r = results[Math.max(active, 0)]
        if (r) fill(r.c.title)
      } else {
        const s = suggestions[Math.max(active, 0)]
        if (s) {
          fill(s.value)
          setActive(-1)
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (busy) return
      if (step.kind === 'list') {
        const r = results[active]
        if (r) choose(r.c)
      } else if (query.trim() || step.allowEmpty) {
        advance(step.submit(query.trim()), crumbOf(query.trim()))
      }
    }
  }

  const hint =
    step.kind === 'list'
      ? 'Up/Down choose · Tab fill · Enter select'
      : `${suggestions.length ? 'Up/Down fill · Tab complete · ' : ''}Enter confirm`

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" onKeyDown={onKey}>
        <div className="palette-input">
          {crumbs.map((c, i) => (
            <span key={i} className="palette-crumb" title="Backspace to go back">
              {c}
            </span>
          ))}
          <input
            ref={inputRef}
            value={query}
            placeholder={step.placeholder}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setTyped(e.target.value)
              setActive(step.kind === 'input' ? -1 : 0)
            }}
          />
          {busy && <span className="spinner" />}
        </div>
        {step.kind === 'list' && (
          <div className="palette-list" ref={listRef}>
            {results.slice(0, MAX_RENDERED).map(({ c, hits }, i) => (
              <div
                key={c.id}
                className={`palette-item ${i === active ? 'active' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(c)}
              >
                <span className="grow ellipsis">
                  <Highlight text={c.title} hits={hits} />
                  {c.detail && <span className="palette-detail">{c.detail}</span>}
                </span>
                {c.cmdline && <code className="palette-cmd">{c.cmdline}</code>}
                {c.keys && <kbd>{formatKeys(c.keys)}</kbd>}
              </div>
            ))}
            {results.length === 0 && <div className="palette-empty">No matches</div>}
          </div>
        )}
        {step.kind === 'input' && suggestions.length > 0 && (
          <div className="palette-list" ref={listRef}>
            {suggestions.map((s, i) => (
              <div
                key={s.value + i}
                className={`palette-item ${i === active ? 'active' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => {
                  fill(s.value)
                  setActive(-1)
                }}
              >
                <span className="grow ellipsis mono">{s.value}</span>
                {s.detail && <span className="palette-detail">{s.detail}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="palette-hint">
          {hint}
          {stack.length > 1 ? ' · Backspace back' : ''} · Esc close
        </div>
      </div>
    </div>
  )
}
