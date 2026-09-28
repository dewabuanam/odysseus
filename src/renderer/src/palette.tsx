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
  run(): void | Step | Promise<void | Step>
}

export type Step =
  | { kind: 'list'; placeholder: string; items: Cmd[] }
  | { kind: 'input'; placeholder: string; value?: string; submit(value: string): void | Step | Promise<void | Step> }

const isMac = navigator.userAgent.includes('Mac')

export function formatKeys(keys: string): string {
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

const RECENT_KEY = 'odysseus.palette.recent'
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}
function pushRecent(id: string) {
  try {
    const list = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 12)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}

// ------------------------------------------------------------------ component

const MAX_RENDERED = 150

export function Palette({ initial, onClose }: { initial: Step; onClose(): void }) {
  const [stack, setStack] = useState<Step[]>([initial])
  const [query, setQuery] = useState(initial.kind === 'input' ? initial.value ?? '' : '')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const step = stack[stack.length - 1]
  const isRoot = stack.length === 1

  const results = useMemo(() => {
    if (step.kind !== 'list') return []
    const items = step.items.filter((c) => c.when !== false)
    if (!query.trim()) {
      if (!isRoot) return items.map((c) => ({ c, hits: [] as number[] }))
      const recent = loadRecent()
      const rank = (c: Cmd) => {
        const i = recent.indexOf(c.id)
        return i === -1 ? 999 : i
      }
      return [...items].sort((a, b) => rank(a) - rank(b)).map((c) => ({ c, hits: [] as number[] }))
    }
    const scored: { c: Cmd; hits: number[]; score: number }[] = []
    for (const c of items) {
      const m = fuzzy(query, c.title)
      if (m) scored.push({ c, hits: m.hits, score: m.score })
      else if (c.detail) {
        const d = fuzzy(query, c.detail)
        if (d) scored.push({ c, hits: [], score: d.score - 5 })
      }
    }
    return scored.sort((a, b) => b.score - a.score)
  }, [step, query, isRoot])

  useEffect(() => setActive(0), [query, step])
  useEffect(() => inputRef.current?.focus(), [step])

  useLayoutEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const advance = async (next: void | Step | Promise<void | Step>) => {
    setBusy(true)
    try {
      const r = await next
      if (r) {
        setStack((s) => [...s, r])
        setQuery(r.kind === 'input' ? r.value ?? '' : '')
      } else onClose()
    } catch (e) {
      console.error(e)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const choose = (c: Cmd) => {
    if (isRoot) pushRecent(c.id)
    advance(c.run())
  }

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Backspace' && !query && stack.length > 1) {
      e.preventDefault()
      setStack((s) => s.slice(0, -1))
    } else if (step.kind === 'list' && (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n'))) {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.min(results.length, MAX_RENDERED) - 1))
    } else if (step.kind === 'list' && (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p'))) {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (step.kind === 'list' && e.key === 'PageDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 10, Math.min(results.length, MAX_RENDERED) - 1))
    } else if (step.kind === 'list' && e.key === 'PageUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 10, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (busy) return
      if (step.kind === 'list') {
        const r = results[active]
        if (r) choose(r.c)
      } else if (query.trim()) {
        advance(step.submit(query.trim()))
      }
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" onKeyDown={onKey}>
        <div className="palette-input">
          {stack.length > 1 && <span className="palette-crumb">{stack.length - 1}</span>}
          <input
            ref={inputRef}
            value={query}
            placeholder={step.placeholder}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          {busy && <span className="spinner" />}
        </div>
        {step.kind === 'list' ? (
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
                {c.keys && <kbd>{formatKeys(c.keys)}</kbd>}
              </div>
            ))}
            {results.length === 0 && <div className="palette-empty">No matches</div>}
          </div>
        ) : (
          <div className="palette-hint">Enter to confirm{stack.length > 1 ? ', Backspace to go back' : ''}, Esc to cancel</div>
        )}
      </div>
    </div>
  )
}
