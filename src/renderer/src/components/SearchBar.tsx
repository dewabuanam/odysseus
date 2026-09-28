import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SEARCH_KEYS, tokenize } from '@shared/search'

interface Props {
  value: string
  onChange(v: string): void
  inputRef?: React.RefObject<HTMLInputElement | null>
  /** Values offered after `branch:` / `tag:` */
  refs: string[]
  /** Values offered after `author:` / `committer:` */
  people: string[]
  /** Values offered after `path:` */
  paths: string[]
  resultCount: number | null
  busy: boolean
}

interface Suggestion {
  insert: string
  label: string
  detail?: string
  /** Replaces the whole token (key + value) rather than completing a key */
  complete: boolean
}

/** Finds the token under the caret: its text and where it starts. */
function currentToken(value: string, caret: number): { start: number; text: string } {
  let start = 0
  let quoted = false
  for (let i = 0; i < caret; i++) {
    const ch = value[i]
    if (ch === '"') quoted = !quoted
    else if (/\s/.test(ch) && !quoted) start = i + 1
  }
  return { start, text: value.slice(start, caret) }
}

const quote = (v: string) => (/[\s"]/.test(v) || v === '' ? `"${v.replace(/"/g, '')}"` : `"${v}"`)

/**
 * Commit search with keys: `author:"sam" branch:"master" fix`.
 * Typing a key prefix suggests keys; after `key:` it suggests values (branches, authors,
 * paths, dates). Up/Down choose, Enter or Tab accept, Esc closes then clears.
 */
export function SearchBar({ value, onChange, inputRef, refs, people, paths, resultCount, busy }: Props) {
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // Caret to restore right after React renders an accepted suggestion (before any further
  // keystrokes are processed), so fast typing continues at the right place.
  const pendingCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    const p = pendingCaret.current
    if (p === null) return
    pendingCaret.current = null
    inputRef?.current?.setSelectionRange(p, p)
    setCaret(p)
  }, [value, inputRef])

  const token = currentToken(value, caret)

  const suggestions = useMemo<Suggestion[]>(() => {
    const t = token.text
    const kv = t.match(/^([a-z-]+):(.*)$/i)
    if (kv) {
      const key = kv[1].toLowerCase()
      const partial = kv[2].replace(/^"/, '').replace(/"$/, '').toLowerCase()
      const def = SEARCH_KEYS.find((k) => k.key === key)
      let values: { value: string; detail?: string }[] = def?.examples ?? []
      if (key === 'branch' || key === 'tag') values = refs.map((r) => ({ value: r }))
      if (key === 'author' || key === 'committer') values = [...(def?.examples ?? []), ...people.map((p) => ({ value: p }))]
      if (key === 'path') values = paths.map((p) => ({ value: p }))
      return values
        .filter((v) => v.value.toLowerCase().includes(partial) && v.value.toLowerCase() !== partial)
        .slice(0, 12)
        .map((v) => ({ insert: `${key}:${quote(v.value)} `, label: v.value, detail: v.detail, complete: true }))
    }
    // Only suggest keys while a word is being typed, not after every space.
    if (!t) return []
    const lower = t.toLowerCase()
    return SEARCH_KEYS.filter((k) => k.key.startsWith(lower) && k.key !== lower).map((k) => ({
      insert: `${k.key}:`,
      label: `${k.key}:`,
      detail: k.description,
      complete: false
    }))
  }, [token.text, refs, people, paths])

  const show = open && suggestions.length > 0

  const accept = (s: Suggestion) => {
    const before = value.slice(0, token.start)
    const after = value.slice(caret).replace(/^\S*/, '')
    const next = before + s.insert + after.replace(/^\s+/, s.complete ? '' : '')
    onChange(next)
    pendingCaret.current = (before + s.insert).length
    setActive(0)
    setOpen(true)
  }

  const keys = tokenize(value).filter((t) => /^[a-z-]+:/i.test(t)).length

  return (
    <div className="searchbar">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="faint"><circle cx="7" cy="7" r="5" /><path d="m11 11 3.5 3.5" /></svg>
      <div className="searchbar-field">
        <input
          ref={inputRef}
          className="searchbar-input"
          placeholder='Search commits: author:"name" branch:main path:src after:"1 week ago" words…'
          value={value}
          spellCheck={false}
          onChange={(e) => {
            onChange(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setOpen(true)
            setActive(0)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (show && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
            } else if (show && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault()
              accept(suggestions[active])
            } else if (e.key === 'Escape') {
              if (show) setOpen(false)
              else {
                onChange('')
                e.currentTarget.blur()
              }
            }
          }}
        />
        {show && (
          <div className="searchbar-menu">
            {suggestions.map((s, i) => (
              <div
                key={s.insert}
                className={`searchbar-item ${i === active ? 'active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(s)
                }}
                onMouseMove={() => setActive(i)}
              >
                <span className="searchbar-kind">{s.complete ? 'v' : 's'}</span>
                <span className="mono">{s.label}</span>
                {s.detail && <span className="faint grow ellipsis" style={{ fontSize: 11, textAlign: 'right' }}>{s.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      {busy ? <span className="spinner" /> : resultCount !== null && <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{resultCount} found{keys ? '' : ''}</span>}
      {value && (
        <button className="btn small ghost" title="Clear search (Esc)" onClick={() => onChange('')}>
          ×
        </button>
      )}
    </div>
  )
}
