import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EditorFile } from '@shared/types'
import {
  applyLineOp,
  buildRegex,
  countLines,
  detectIndent,
  findAll,
  formatJson,
  JsonError,
  languageOf,
  lineCol,
  lineComment,
  lineStart,
  minifyJson,
  MAX_MATCHES,
  replaceAll,
  replacement,
  type FindOptions,
  type LineOp
} from '@shared/textOps'
import { isMarkdownPath, parseMarkdown } from '@shared/markdown'
import { api } from '../api'
import { UiProvider, useUi, type MenuItem } from '../ui'
import { followLink, MarkdownPreview } from './MarkdownPreview'
import './editor.css'

/** Wrapped lines get exact line numbers up to this many lines; beyond it the gutter hides. */
const WRAP_GUTTER_MAX = 20000
/** Matches are highlighted behind the text up to this file size. */
const HIGHLIGHT_MAX = 3_000_000
/** The markdown preview waits this long after typing stops before it redraws. */
const PREVIEW_DELAY = 120

type MdView = 'edit' | 'split' | 'preview'
const MD_VIEWS: [MdView, string][] = [
  ['edit', 'Edit'],
  ['split', 'Split'],
  ['preview', 'Preview']
]

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '')
const isMac = navigator.platform.toLowerCase().includes('mac')

const loadPref = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(`odysseus.editor.${key}`)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
const savePref = (key: string, v: unknown) => {
  try {
    localStorage.setItem(`odysseus.editor.${key}`, JSON.stringify(v))
  } catch {
    // Preferences are a convenience; the editor works without them.
  }
}

export function EditorRoot({ path }: { path: string }) {
  return (
    <UiProvider>
      <EditorWindow initialPath={path} />
    </UiProvider>
  )
}

type Banner = { kind: 'changed' | 'deleted' } | null

/**
 * A small text editor in its own window, for a file as it is on disk now: line numbers,
 * find and replace (regex, whole word, match case), go to line, JSON formatting, line tools,
 * a live preview beside markdown files, and the file's own line endings and byte order mark
 * kept on save.
 */
function EditorWindow({ initialPath }: { initialPath: string }) {
  const ui = useUi()
  const [path, setPath] = useState(initialPath)
  const [file, setFile] = useState<EditorFile | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [eol, setEol] = useState<'CRLF' | 'LF'>('LF')
  const [dirty, setDirty] = useState(false)
  const [banner, setBanner] = useState<Banner>(null)
  const [wrap, setWrap] = useState(() => loadPref('wrap', false))
  const [fontSize, setFontSize] = useState(() => loadPref('fontSize', 13))
  const [platform, setPlatform] = useState('win32')
  const [caret, setCaret] = useState({ line: 1, col: 1, sel: 0, selLines: 0 })
  const [find, setFind] = useState<'find' | 'replace' | null>(null)
  const [query, setQuery] = useState('')
  const [replaceWith, setReplaceWith] = useState('')
  const [opts, setOpts] = useState<FindOptions>(() => loadPref('find', { caseSensitive: false, wholeWord: false, regex: false }))
  const [current, setCurrent] = useState(-1)
  const [heights, setHeights] = useState<number[] | null>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const [mdView, setMdView] = useState<MdView>(() => loadPref('mdView', 'split'))
  const [mdText, setMdText] = useState<string | null>(null)

  const ta = useRef<HTMLTextAreaElement>(null)
  const gutterInner = useRef<HTMLDivElement>(null)
  const backInner = useRef<HTMLDivElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const previewBox = useRef<HTMLDivElement>(null)
  const saved = useRef('')
  const bom = useRef(false)

  const lineHeight = Math.round(fontSize * 1.5)
  const text = () => ta.current?.value ?? ''
  const name = baseName(path)
  const isMd = isMarkdownPath(path)
  const view: MdView = isMd ? mdView : 'edit'

  // ------------------------------------------------------------ loading and saving

  const load = useCallback(async (p: string, keepCaret = false) => {
    try {
      const f = await api.readFile(p)
      const el = ta.current
      const at = keepCaret && el ? [el.selectionStart, el.selectionEnd, el.scrollTop, el.scrollLeft] : null
      setFile(f)
      setLoadError(null)
      setEol(f.eol)
      bom.current = f.bom
      saved.current = f.text
      if (el) {
        el.value = f.text
        if (at) {
          el.setSelectionRange(Math.min(at[0], f.text.length), Math.min(at[1], f.text.length))
          el.scrollTop = at[2]
          el.scrollLeft = at[3]
        } else {
          el.setSelectionRange(0, 0)
          el.scrollTop = 0
        }
      }
      setBanner(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setLoadError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    load(path)
  }, [path, load])

  useEffect(() => {
    api.platform().then(setPlatform)
    api.getSettings().then((s) => (document.documentElement.dataset.theme = s.theme))
  }, [])

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${name} - Odysseus`
  }, [dirty, name])

  // Dirty state goes to the main process, which asks before closing with unsaved changes.
  useEffect(() => {
    const d = file !== null && text() !== saved.current
    if (d !== dirty) {
      setDirty(d)
      api.editorDirty(d)
    }
  }, [version, file])

  const save = useCallback(async (): Promise<boolean> => {
    if (!file) return false
    const t = text()
    try {
      await api.writeFile(path, t, eol, bom.current)
      saved.current = t
      setBanner(null)
      setVersion((v) => v + 1)
      if (file.eol !== eol) setFile({ ...file, eol })
      return true
    } catch (e) {
      ui.toast(`Couldn't save ${name}: ${(e as Error).message}`, true)
      return false
    }
  }, [file, path, eol, name, ui])

  const saveRef = useRef(save)
  saveRef.current = save
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(
    () =>
      window.ody.on(async (ch, payload) => {
        if (ch === 'editorSaveAndClose') {
          if (await saveRef.current()) api.editorClose()
        } else if (ch === 'editorFileChanged') {
          const p = payload as { exists: boolean }
          if (!p.exists) setBanner({ kind: 'deleted' })
          else if (dirtyRef.current) setBanner({ kind: 'changed' })
          else {
            await load(path, true)
            ui.toast('Reloaded: the file changed on disk')
          }
        }
      }),
    [path, load, ui]
  )

  // ------------------------------------------------------------ editing primitives

  /** Replaces a range the way typing would, so Ctrl+Z undoes it. */
  const edit = (start: number, end: number, insert: string, selStart?: number, selEnd?: number) => {
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(start, end)
    if (!document.execCommand(insert ? 'insertText' : 'delete', false, insert)) {
      el.setRangeText(insert, start, end, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (selStart !== undefined) el.setSelectionRange(selStart, selEnd ?? selStart)
  }

  /** The whole lines the selection touches: [start, end) with end before the last line break. */
  const selectedLines = () => {
    const el = ta.current!
    const t = el.value
    const s = el.selectionStart
    let e = el.selectionEnd
    if (e > s && t[e - 1] === '\n') e--
    const start = t.lastIndexOf('\n', s - 1) + 1
    let end = t.indexOf('\n', e)
    if (end === -1) end = t.length
    return { start, end, t }
  }

  const indentUnit = useMemo(() => (file ? detectIndent(file.text) : '  '), [file])

  const updateCaret = () => {
    const el = ta.current
    if (!el) return
    const t = el.value
    const { line, col } = lineCol(t, el.selectionStart)
    const sel = el.selectionEnd - el.selectionStart
    const selLines = sel ? countLines(t.slice(el.selectionStart, el.selectionEnd)) : 0
    setCaret((c) => (c.line === line && c.col === col && c.sel === sel && c.selLines === selLines ? c : { line, col, sel, selLines }))
  }

  /** Scrolls the text so an offset is in view (centered when it was out of view). */
  const reveal = (offset: number) => {
    const el = ta.current
    if (!el) return
    const { line, col } = lineCol(el.value, offset)
    const top = heights ? heights.slice(0, line - 1).reduce((a, b) => a + b, 0) : (line - 1) * lineHeight
    if (top < el.scrollTop || top + lineHeight > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight / 2
    if (!wrap) {
      const x = (col - 1) * fontSize * 0.6
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
    }
  }

  const goToLine = async () => {
    if (view === 'preview') showView('split')
    const r = await ui.ask({ title: 'Go to line', input: { label: `Line (1 to ${countLines(text())}), or line:column`, placeholder: `${caret.line}` }, confirmLabel: 'Go' })
    const m = r && /^(\d+)(?::(\d+))?$/.exec(r.value)
    if (!m || !ta.current) return
    const t = text()
    const s = lineStart(t, Number(m[1]))
    const lineEnd = t.indexOf('\n', s) === -1 ? t.length : t.indexOf('\n', s)
    const at = Math.min(lineEnd, s + Math.max(0, Number(m[2] ?? 1) - 1))
    ta.current.focus()
    ta.current.setSelectionRange(at, at)
    reveal(at)
    updateCaret()
  }

  // ------------------------------------------------------------ tools

  const transformAll = (fn: (t: string) => string, done?: string) => {
    const t = text()
    let out: string
    try {
      out = fn(t)
    } catch (e) {
      ui.toast((e as Error).message, true)
      if (e instanceof JsonError && e.offset !== null && ta.current) {
        ta.current.focus()
        ta.current.setSelectionRange(e.offset, Math.min(t.length, e.offset + 1))
        reveal(e.offset)
      }
      return
    }
    if (out === t) return void ui.toast('Nothing to change')
    const el = ta.current!
    const top = el.scrollTop
    edit(0, t.length, out, 0)
    el.scrollTop = top
    if (done) ui.toast(done)
  }

  /** A JSON tool works on the selection when there is one, else on the whole file. */
  const jsonTool = (fn: (t: string) => string) => {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    if (e === s) return transformAll((t) => fn(t))
    try {
      const out = fn(el.value.slice(s, e))
      edit(s, e, out, s, s + out.length)
    } catch (err) {
      ui.toast((err as Error).message, true)
    }
  }

  const linesTool = (op: LineOp | ((lines: string[]) => string[])) => {
    const el = ta.current
    if (!el) return
    const whole = el.selectionStart === el.selectionEnd
    const { start, end, t } = whole ? { start: 0, end: el.value.length, t: el.value } : selectedLines()
    const lines = t.slice(start, end).split('\n')
    const out = (typeof op === 'function' ? op(lines) : applyLineOp(lines, op)).join('\n')
    if (out === t.slice(start, end)) return void ui.toast('Nothing to change')
    edit(start, end, out, whole ? 0 : start, whole ? 0 : start + out.length)
  }

  const selectionCase = (upper: boolean) => {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    if (s === e) return void ui.toast('Select some text first')
    const t = el.value.slice(s, e)
    edit(s, e, upper ? t.toUpperCase() : t.toLowerCase(), s, e)
  }

  const toggleComment = () => {
    const mark = lineComment(name)
    if (!mark) return void ui.toast(`No line comments for ${languageOf(path)} files`)
    linesTool((lines) => {
      const code = lines.filter((l) => l.trim())
      const off = code.length > 0 && code.every((l) => l.trimStart().startsWith(mark))
      if (off) return lines.map((l) => l.replace(new RegExp(`^(\\s*)${mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ?`), '$1'))
      const pad = Math.min(...code.map((l) => l.length - l.trimStart().length))
      return lines.map((l) => (l.trim() ? `${l.slice(0, pad)}${mark} ${l.slice(pad)}` : l))
    })
  }

  const moveLines = (dir: -1 | 1) => {
    const el = ta.current
    if (!el) return
    const { start, end, t } = selectedLines()
    const offS = el.selectionStart - start
    const offE = el.selectionEnd - start
    const block = t.slice(start, end)
    if (dir < 0) {
      if (start === 0) return
      const prevStart = t.lastIndexOf('\n', start - 2) + 1
      const prev = t.slice(prevStart, start - 1)
      edit(prevStart, end, `${block}\n${prev}`, prevStart + offS, prevStart + offE)
    } else {
      if (end >= t.length) return
      let nextEnd = t.indexOf('\n', end + 1)
      if (nextEnd === -1) nextEnd = t.length
      const next = t.slice(end + 1, nextEnd)
      const at = start + next.length + 1
      edit(start, nextEnd, `${next}\n${block}`, at + offS, at + offE)
    }
  }

  const duplicate = () => {
    const el = ta.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    if (s !== e) return edit(e, e, el.value.slice(s, e), e, e + (e - s))
    const { start, end, t } = selectedLines()
    edit(end, end, `\n${t.slice(start, end)}`, s + (end - start) + 1)
  }

  const deleteLines = () => {
    const { start, end, t } = selectedLines()
    if (end < t.length) edit(start, end + 1, '', start)
    else edit(Math.max(0, start - 1), end, '', Math.max(0, start - 1))
  }

  const convertEol = (to: 'CRLF' | 'LF') => {
    setEol(to)
    // The text inside always uses \n; the change shows as unsaved until written.
    setDirty(true)
    api.editorDirty(true)
    ui.toast(`Line endings: ${to} when saved`)
  }

  const openFile = async () => {
    const p = await api.pickFile(dirName(path))
    if (p) api.openEditor(p)
  }

  const zoom = (d: number | null) => {
    const next = d === null ? 13 : Math.max(8, Math.min(32, fontSize + d))
    setFontSize(next)
    savePref('fontSize', next)
  }
  const toggleWrap = () => {
    setWrap(!wrap)
    savePref('wrap', !wrap)
  }
  const showView = (v: MdView) => {
    setMdView(v)
    savePref('mdView', v)
    if (v !== 'preview') requestAnimationFrame(() => ta.current?.focus())
  }
  const cycleView = () => showView(MD_VIEWS[(MD_VIEWS.findIndex(([v]) => v === view) + 1) % MD_VIEWS.length][0])

  const toolsMenu = (): MenuItem[] => [
    { label: 'Format JSON (Alt+Shift+F)', action: () => jsonTool((t) => formatJson(t, indentUnit === '\t' ? '\t' : indentUnit.length)) },
    { label: 'Minify JSON', action: () => jsonTool(minifyJson) },
    { separator: true, label: '' },
    { label: 'Toggle comment (Ctrl+/)', action: toggleComment },
    { label: 'Duplicate line (Ctrl+D)', action: duplicate },
    { label: 'Delete line (Ctrl+Shift+K)', action: deleteLines },
    {
      label: 'Lines',
      submenu: [
        { label: 'Sort A to Z', action: () => linesTool('sort') },
        { label: 'Sort Z to A', action: () => linesTool('sortDesc') },
        { label: 'Reverse order', action: () => linesTool('reverse') },
        { label: 'Remove duplicates', action: () => linesTool('unique') },
        { label: 'Remove empty lines', action: () => linesTool('removeEmpty') },
        { label: 'Trim trailing spaces', action: () => linesTool('trim') }
      ]
    },
    {
      label: 'Selection',
      submenu: [
        { label: 'UPPERCASE', action: () => selectionCase(true) },
        { label: 'lowercase', action: () => selectionCase(false) }
      ]
    },
    {
      label: 'Line endings',
      submenu: [
        { label: `${eol === 'LF' ? '✓ ' : ''}LF (Unix, macOS)`, action: () => eol !== 'LF' && convertEol('LF') },
        { label: `${eol === 'CRLF' ? '✓ ' : ''}CRLF (Windows)`, action: () => eol !== 'CRLF' && convertEol('CRLF') }
      ]
    },
    { separator: true, label: '' },
    ...(isMd
      ? [
          {
            label: 'Markdown view (Ctrl+Shift+V)',
            submenu: MD_VIEWS.map(([v, label]) => ({ label: `${view === v ? '✓ ' : ''}${label}`, action: () => showView(v) }))
          }
        ]
      : []),
    { label: `${wrap ? '✓ ' : ''}Word wrap (Alt+Z)`, action: toggleWrap },
    { label: 'Go to line… (Ctrl+G)', action: goToLine },
    { label: 'Reload from disk', action: () => load(path, true) },
    { separator: true, label: '' },
    { label: 'Show in folder', action: () => api.showInFolder(path) },
    { label: 'Open with default app', action: () => api.openExternal(path) }
  ]

  // ------------------------------------------------------------ find and replace

  const re = useMemo(() => buildRegex(query, opts), [query, opts])
  const matches = useMemo(() => (find && re instanceof RegExp ? findAll(text(), re) : []), [find, re, version])

  const setOpt = (k: keyof FindOptions) => {
    const next = { ...opts, [k]: !opts[k] }
    setOpts(next)
    savePref('find', next)
  }

  const select = (i: number, focusText = false) => {
    const el = ta.current
    const m = matches[i]
    if (!el || !m) return
    setCurrent(i)
    if (focusText) el.focus()
    el.setSelectionRange(m[0], m[1])
    reveal(m[0])
    updateCaret()
  }

  const findStep = (dir: 1 | -1) => {
    if (!matches.length) return
    const el = ta.current!
    const from = dir > 0 ? el.selectionEnd : el.selectionStart
    let i = dir > 0 ? matches.findIndex((m) => m[0] >= from) : matches.reduce((last, m, j) => (m[1] <= from ? j : last), -1)
    // At the edge: wrap around, like Notepad++.
    if (i === -1) i = dir > 0 ? 0 : matches.length - 1
    // The current match is already selected: step past it.
    if (dir > 0 && matches[i][0] === el.selectionStart && matches[i][1] === el.selectionEnd) i = (i + 1) % matches.length
    select(i)
  }

  const replaceOne = () => {
    const el = ta.current
    if (!el || !(re instanceof RegExp)) return
    const hit = matches.findIndex((m) => m[0] === el.selectionStart && m[1] === el.selectionEnd)
    if (hit === -1) return findStep(1)
    const [s, e] = matches[hit]
    const out = replacement(el.value, s, e, re, replaceWith, opts.regex)
    edit(s, e, out, s + out.length)
    findInput.current?.focus()
    // Select the next match after the replaced text once matches are recomputed.
    requestAnimationFrame(() => findStepRef.current(1))
  }
  const findStepRef = useRef(findStep)
  findStepRef.current = findStep

  const replaceEvery = () => {
    if (!(re instanceof RegExp)) return
    const t = text()
    const r = replaceAll(t, re, replaceWith, opts.regex)
    if (!r.count) return void ui.toast('No matches')
    const el = ta.current!
    const top = el.scrollTop
    edit(0, t.length, r.text, 0)
    el.scrollTop = top
    ui.toast(`Replaced ${r.count} match${r.count === 1 ? '' : 'es'}`)
  }

  const openFind = (mode: 'find' | 'replace') => {
    if (view === 'preview') showView('split')
    const el = ta.current
    const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
    if (sel && !sel.includes('\n')) setQuery(sel)
    setFind(mode)
    requestAnimationFrame(() => {
      findInput.current?.focus()
      findInput.current?.select()
    })
  }

  // The match the caret is on (or after) is the current one.
  useEffect(() => {
    const el = ta.current
    if (!el || !matches.length) return setCurrent(-1)
    const i = matches.findIndex((m) => m[1] > el.selectionStart)
    setCurrent(i === -1 ? 0 : i)
  }, [matches])

  // ------------------------------------------------------------ keys

  const onTextKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: end } = el
      const multi = el.value.slice(s, end).includes('\n')
      if (!e.shiftKey && !multi) return edit(s, end, indentUnit)
      const { start, end: lineEnd, t } = selectedLines()
      const lines = t.slice(start, lineEnd).split('\n')
      const out = lines.map((l) => (e.shiftKey ? l.replace(new RegExp(`^(\\t| {1,${indentUnit === '\t' ? 4 : indentUnit.length}})`), '') : l ? indentUnit + l : l))
      const joined = out.join('\n')
      if (joined !== t.slice(start, lineEnd)) edit(start, lineEnd, joined, start, start + joined.length)
      return
    }
    if (e.key === 'Enter' && !mod && !e.altKey && !e.shiftKey) {
      // Keep the line's indentation; one more level after an opening bracket.
      e.preventDefault()
      const { selectionStart: s, selectionEnd: end, value: t } = el
      const ls = t.lastIndexOf('\n', s - 1) + 1
      const ind = /^[ \t]*/.exec(t.slice(ls, s))![0]
      const before = t[s - 1]
      const after = t[end]
      const opens = before === '{' || before === '[' || before === '('
      if (opens && after && '}])'.includes(after)) {
        const mid = `\n${ind}${indentUnit}`
        return edit(s, end, `${mid}\n${ind}`, s + mid.length)
      }
      return edit(s, end, `\n${ind}${opens ? indentUnit : ''}`)
    }
    if (mod && !e.shiftKey && e.key === '/') return (e.preventDefault(), toggleComment())
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') return (e.preventDefault(), duplicate())
    if (mod && e.shiftKey && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'l')) return (e.preventDefault(), deleteLines())
    if ((e.altKey || (mod && e.shiftKey)) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return (e.preventDefault(), moveLines(e.key === 'ArrowUp' ? -1 : 1))
  }

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey
    const k = e.key.toLowerCase()
    const take = (fn: () => void) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    }
    if (mod && !e.shiftKey && k === 's') return take(() => save())
    if (mod && !e.shiftKey && k === 'f') return take(() => openFind('find'))
    if (mod && !e.shiftKey && (k === 'h' || (isMac && e.altKey && k === 'f'))) return take(() => openFind('replace'))
    if (mod && !e.shiftKey && k === 'g') return take(goToLine)
    if (mod && !e.shiftKey && k === 'o') return take(openFile)
    if (mod && !e.shiftKey && k === 'w') return take(() => window.close())
    if (mod && (k === '=' || k === '+')) return take(() => zoom(1))
    if (mod && k === '-') return take(() => zoom(-1))
    if (mod && k === '0') return take(() => zoom(null))
    if (e.altKey && !mod && k === 'z') return take(toggleWrap)
    if (isMd && mod && e.shiftKey && k === 'v') return take(cycleView)
    if (e.altKey && e.shiftKey && k === 'f') return take(() => jsonTool((t) => formatJson(t, indentUnit === '\t' ? '\t' : indentUnit.length)))
    if (e.key === 'F3') return take(() => (find ? findStep(e.shiftKey ? -1 : 1) : openFind('find')))
    if (e.key === 'Escape' && find && !document.querySelector('.overlay')) return take(() => (setFind(null), ta.current?.focus()))
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [])

  // Files dropped on the window open in editor windows of their own.
  useEffect(() => {
    const over = (e: DragEvent) => e.dataTransfer?.types.includes('Files') && e.preventDefault()
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      for (const f of e.dataTransfer.files) {
        const p = window.ody.pathForFile(f)
        if (p && (await api.pathKind(p)) === 'file') api.openEditor(p)
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // ------------------------------------------------------------ gutter, highlights and scrolling

  const lines = useMemo(() => countLines(text()), [version, file])
  const numbers = useMemo(() => Array.from({ length: lines }, (_, i) => i + 1).join('\n'), [lines])

  const syncScroll = () => {
    const el = ta.current
    if (!el) return
    if (gutterInner.current) gutterInner.current.style.transform = `translateY(${-el.scrollTop}px)`
    if (backInner.current) backInner.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`
  }

  // Wrapped lines are measured in a hidden copy of the text so line numbers sit beside them.
  useLayoutEffect(() => {
    const el = ta.current
    const m = mirror.current
    if (!wrap || !el || !m || lines > WRAP_GUTTER_MAX) return setHeights(null)
    const run = () => {
      const cs = getComputedStyle(el)
      m.style.width = `${el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`
      const frag = document.createDocumentFragment()
      for (const l of el.value.split('\n')) {
        const d = document.createElement('div')
        d.textContent = l || '​'
        frag.appendChild(d)
      }
      m.replaceChildren(frag)
      const hs = [...m.children].map((c) => (c as HTMLElement).offsetHeight)
      m.replaceChildren()
      setHeights(hs)
    }
    const t = setTimeout(run, 60)
    return () => clearTimeout(t)
  }, [wrap, version, fontSize, boxWidth, lines, file])

  useEffect(() => {
    const el = ta.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [file])

  useLayoutEffect(syncScroll)

  // ------------------------------------------------------------ markdown preview

  // The preview reads the text a moment after typing stops, so long files stay quick to edit.
  useEffect(() => {
    if (view === 'edit') return setMdText(null)
    if (!file) return
    const t = setTimeout(() => setMdText(text()), mdText === null ? 0 : PREVIEW_DELAY)
    return () => clearTimeout(t)
  }, [view, version, file])
  const doc = useMemo(() => (view !== 'edit' && mdText !== null ? parseMarkdown(mdText) : null), [view, mdText])

  /** Scrolls the preview to the block at the top of the text box. */
  const syncPreview = () => {
    const el = ta.current
    const box = previewBox.current
    if (view !== 'split' || !el || !box) return
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) return void (box.scrollTop = box.scrollHeight)
    let top = el.scrollTop / lineHeight
    if (heights) {
      let y = 0
      let i = 0
      while (i < heights.length && y + heights[i] <= el.scrollTop) y += heights[i++]
      top = i + (heights[i] ? (el.scrollTop - y) / heights[i] : 0)
    }
    let a = { line: 0, y: 0 }
    let b: typeof a | null = null
    for (const node of box.querySelectorAll<HTMLElement>('[data-line]')) {
      const at = { line: Number(node.dataset.line), y: node.offsetTop }
      if (at.line <= top) a = at
      else {
        b = at
        break
      }
    }
    box.scrollTop = b ? a.y + ((b.y - a.y) * (top - a.line)) / Math.max(1, b.line - a.line) : a.y + (top - a.line) * lineHeight
  }
  useLayoutEffect(syncPreview, [doc, view])

  const toggleTask = (line: number) => {
    const t = text()
    const s = lineStart(t, line + 1)
    const e = t.indexOf('\n', s)
    const m = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\]/.exec(t.slice(s, e === -1 ? t.length : e))
    if (!m) return
    const at = s + m[1].length
    edit(at, at + 1, m[2] === ' ' ? 'x' : ' ', at + 1)
    // Ticking a box in the preview alone shouldn't leave the hidden text taking keys.
    if (view === 'preview') ta.current?.blur()
  }

  const highlight = find && matches.length > 0 && text().length <= HIGHLIGHT_MAX
  const backdrop = useMemo<ReactNode>(() => {
    if (!highlight) return null
    const t = text()
    const out: ReactNode[] = []
    let at = 0
    matches.forEach(([s, e], i) => {
      out.push(t.slice(at, s), <mark key={i} className={i === current ? 'cur' : ''}>{t.slice(s, e)}</mark>)
      at = e
    })
    out.push(t.slice(at), '\n')
    return out
  }, [highlight, matches, current])

  // ------------------------------------------------------------ rendering

  const reOk = re instanceof RegExp
  const reError = typeof re === 'string' ? re : null
  const count = matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : `${matches.length}`
  const mac = platform === 'darwin'
  const gutterChars = Math.max(3, String(lines).length)
  const textStyle = { fontSize, lineHeight: `${lineHeight}px` }

  return (
    <div className={`ed ${mac ? 'mac' : ''}`}>
      <header className="ed-head">
        <span className="ed-name" title={path}>
          {dirty && <span className="ed-dot" title="Unsaved changes" />}
          {name}
        </span>
        <span className="ed-path faint ellipsis" title={path}>{dirName(path)}</span>
        <span className="grow" />
        <div className="ed-actions">
          {isMd && (
            <div className="ed-views" role="group" title="Markdown view (Ctrl+Shift+V)">
              {MD_VIEWS.map(([v, label]) => (
                <button key={v} className={`ed-opt ${view === v ? 'on' : ''}`} onClick={() => showView(v)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <button className="btn small ghost" title="Open a file (Ctrl+O)" onClick={openFile}>Open…</button>
          <button className="btn small ghost" title="Find (Ctrl+F)" onClick={() => openFind('find')}>Find</button>
          <button className="btn small ghost" title="Replace (Ctrl+H)" onClick={() => openFind('replace')}>Replace</button>
          <button className="btn small ghost" title="Format JSON (Alt+Shift+F)" onClick={() => jsonTool((t) => formatJson(t, indentUnit === '\t' ? '\t' : indentUnit.length))}>{'{ }'} Format</button>
          <button
            className="btn small ghost"
            title="More tools"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              ui.menu({ clientX: r.left, clientY: r.bottom + 2 }, toolsMenu())
            }}
          >
            Tools ▾
          </button>
          <button className={`btn small ${dirty ? 'primary' : ''}`} disabled={!file || (!dirty && !banner)} title="Save (Ctrl+S)" onClick={() => save()}>
            Save
          </button>
        </div>
      </header>

      {banner && (
        <div className="ed-banner">
          {banner.kind === 'changed' ? 'This file changed on disk, and you have unsaved changes here.' : 'This file was deleted or moved on disk. Saving writes it again.'}
          <span className="grow" />
          {banner.kind === 'changed' && <button className="btn small" onClick={() => load(path, true)}>Reload, drop my changes</button>}
          <button className="btn small" onClick={() => setBanner(null)}>Keep mine</button>
        </div>
      )}

      {find && (
        <div className="ed-find">
          <div className="ed-find-row">
            <input
              ref={findInput}
              className={`input ed-find-input ${reError || (query && reOk && !matches.length) ? 'bad' : ''}`}
              placeholder="Find"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  findStep(e.shiftKey ? -1 : 1)
                }
              }}
            />
            <button className={`ed-opt ${opts.caseSensitive ? 'on' : ''}`} title="Match case" onClick={() => setOpt('caseSensitive')}>Aa</button>
            <button className={`ed-opt ${opts.wholeWord ? 'on' : ''}`} title="Whole word" onClick={() => setOpt('wholeWord')}><u>ab</u></button>
            <button className={`ed-opt ${opts.regex ? 'on' : ''}`} title="Regular expression" onClick={() => setOpt('regex')}>.*</button>
            <span className="ed-count faint" title={reError ?? undefined}>
              {reError ? 'bad pattern' : query ? (matches.length ? `${current + 1 || '?'} of ${count}` : 'no matches') : ''}
            </span>
            <button className="btn small ghost" disabled={!matches.length} title="Previous (Shift+Enter, Shift+F3)" onClick={() => findStep(-1)}>↑</button>
            <button className="btn small ghost" disabled={!matches.length} title="Next (Enter, F3)" onClick={() => findStep(1)}>↓</button>
            <button className="btn small ghost" title={find === 'find' ? 'Show replace (Ctrl+H)' : 'Hide replace'} onClick={() => setFind(find === 'find' ? 'replace' : 'find')}>
              {find === 'find' ? 'Replace ▸' : 'Replace ▾'}
            </button>
            <button className="btn small ghost" title="Close (Esc)" onClick={() => (setFind(null), ta.current?.focus())}>×</button>
          </div>
          {find === 'replace' && (
            <div className="ed-find-row">
              <input
                className="input ed-find-input"
                placeholder={opts.regex ? 'Replace ($1 for groups)' : 'Replace'}
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (e.ctrlKey || e.metaKey) replaceEvery()
                    else replaceOne()
                  }
                }}
              />
              <button className="btn small" disabled={!matches.length} title="Replace this match (Enter)" onClick={replaceOne}>Replace</button>
              <button className="btn small" disabled={!matches.length} title="Replace every match (Ctrl+Enter)" onClick={replaceEvery}>Replace all</button>
            </div>
          )}
        </div>
      )}

      {loadError ? (
        <div className="ed-error">
          <div>{loadError}</div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn small" onClick={() => load(path)}>Try again</button>
            <button className="btn small" onClick={() => api.openExternal(path)}>Open with default app</button>
          </div>
        </div>
      ) : (
        <div className={`ed-split ${view}`}>
          <div className={`ed-body ${wrap ? 'wrap' : ''}`} aria-hidden={view === 'preview' || undefined}>
            {(!wrap || heights) && (
              <div className="ed-gutter" style={{ ...textStyle, width: `${gutterChars + 2}ch` }}>
                <div ref={gutterInner} className="ed-gutter-inner">
                  {heights
                    ? heights.map((h, i) => (
                        <div key={i} style={{ height: h }} className={i + 1 === caret.line ? 'cur' : ''}>
                          {i + 1}
                        </div>
                      ))
                    : (
                        <>
                          <pre className="ed-numbers">{numbers}</pre>
                          <div className="cur ed-cur-number" style={{ top: (caret.line - 1) * lineHeight, height: lineHeight }}>
                            {caret.line}
                          </div>
                        </>
                      )}
                </div>
              </div>
            )}
            <div className="ed-text">
              {highlight && (
                <div className="ed-backdrop" style={textStyle} aria-hidden>
                  <div ref={backInner} className="ed-backdrop-inner" style={{ width: wrap ? Math.max(0, boxWidth - 24) : undefined }}>
                    {backdrop}
                  </div>
                </div>
              )}
              <textarea
                ref={ta}
                className="ed-area"
                style={textStyle}
                spellCheck={false}
                wrap={wrap ? 'soft' : 'off'}
                disabled={!file}
                onInput={() => {
                  setVersion((v) => v + 1)
                  updateCaret()
                }}
                onScroll={() => (syncScroll(), syncPreview())}
                onSelect={updateCaret}
                onKeyUp={updateCaret}
                onMouseUp={updateCaret}
                onKeyDown={onTextKey}
              />
              <div ref={mirror} className="ed-mirror" style={textStyle} aria-hidden />
            </div>
          </div>
          {view !== 'edit' && doc && (
            <MarkdownPreview
              doc={doc}
              dir={dirName(path)}
              fontSize={fontSize}
              boxRef={previewBox}
              follow={(href) => followLink(href, dirName(path), previewBox.current, (m) => ui.toast(m))}
              toggleTask={toggleTask}
            />
          )}
        </div>
      )}

      <footer className="ed-status">
        <span>Ln {caret.line}, Col {caret.col}</span>
        {caret.sel > 0 && <span>{caret.sel} selected{caret.selLines > 1 ? ` (${caret.selLines} lines)` : ''}</span>}
        <span className="grow" />
        <span>{lines} lines</span>
        <span>{languageOf(path)}</span>
        <span>{indentUnit === '\t' ? 'Tabs' : `Spaces: ${indentUnit.length}`}</span>
        <button className="ed-status-btn" title="Line endings: click to switch" onClick={() => convertEol(eol === 'LF' ? 'CRLF' : 'LF')}>{eol}</button>
        <span>UTF-8{bom.current ? ' BOM' : ''}</span>
        <button className="ed-status-btn" title="Word wrap (Alt+Z)" onClick={toggleWrap}>{wrap ? 'Wrap' : 'No wrap'}</button>
        <button className="ed-status-btn" title="Zoom: Ctrl+= and Ctrl+-, Ctrl+0 resets" onClick={() => zoom(null)}>{Math.round((fontSize / 13) * 100)}%</button>
      </footer>
    </div>
  )
}
