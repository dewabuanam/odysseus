import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { aggregateAi, type AiState, type Settings, type TerminalProfile } from '@shared/types'
import { AI_LABEL, detectAiState, visibleText } from '../aiState'
import { api } from '../api'
import { useUi } from '../ui'

/** Where sessions run: a repository, or a workspace's folder. */
export interface TermScope {
  key: string
  cwd: string
  label: string
  kind: 'repo' | 'workspace'
}

export interface TerminalHandle {
  /** Start a session in the current scope (or the given kind): the profile, or the default one. */
  start(profile?: TerminalProfile, kind?: TermScope['kind']): void
  /** Start the default program when the current scope has no sessions yet. */
  ensure(): void
}

interface Session {
  key: number
  scope: string
  cwd: string
  title: string
  profile: TerminalProfile
  exited: boolean
  /** AI sessions only: what the program is doing */
  ai: AiState | null
}

const SHELL: TerminalProfile = { name: 'Shell', command: '' }
let nextKey = 1

/** Terminal colors from the active theme, so the pane looks like the rest of the app. */
function xtermTheme() {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string) => css.getPropertyValue(n).trim()
  const bg = v('--paper') || '#f6f3ec'
  const fg = v('--ink') || '#1d1d1d'
  return { background: bg, foreground: fg, cursor: fg, cursorAccent: bg, selectionBackground: v('--sel') || 'rgba(128,128,128,0.3)' }
}

export function defaultProfile(s: Settings): TerminalProfile {
  return s.terminalProfiles.find((p) => p.name === s.terminalDefault) ?? SHELL
}

interface Props {
  /** Scopes available for the active tab: its workspace (if any) first, then the repository */
  scopes: TermScope[]
  /** Scope keys still open; sessions of any other scope are ended */
  live: string[]
  open: boolean
  onClose(): void
  /** Most urgent AI state per scope key, and how many sessions are working, on every change */
  onAiStates(states: Record<string, AiState>, working: number): void
  ref?: Ref<TerminalHandle>
}

/**
 * Right-hand pane with real terminals: a shell, or an AI CLI such as Claude Code, started in the
 * repository or its workspace folder. Sessions keep running while the pane is hidden.
 */
export function TerminalPane({ scopes, live, open, onClose, onAiStates, ref }: Props) {
  const ui = useUi()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeBy, setActiveBy] = useState<Record<string, number>>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shellName, setShellName] = useState('Shell')
  const [preferRepo, setPreferRepo] = useState(false)
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('odysseus.terminal.width')) || 560
    } catch {
      return 560
    }
  })

  const scope = (preferRepo && scopes.find((s) => s.kind === 'repo')) || scopes[0] || null
  const mine = sessions.filter((s) => s.scope === scope?.key)
  const active = scope ? activeBy[scope.key] ?? mine[mine.length - 1]?.key : undefined

  const loadSettings = useCallback(async () => {
    const s = await api.getSettings()
    setSettings(s)
    const p = await api.platform()
    const exe = s.terminalShell.trim().split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
    setShellName(exe || (p === 'win32' ? 'PowerShell' : 'Shell'))
    return s
  }, [])

  useEffect(() => {
    if (open) loadSettings()
  }, [open, loadSettings])

  const start = useCallback(
    (profile: TerminalProfile, sc: TermScope | null = scope) => {
      if (!sc) return
      const key = nextKey++
      setSessions((s) => [...s, { key, scope: sc.key, cwd: sc.cwd, title: profile.command ? profile.name : shellName, profile, exited: false, ai: profile.command ? 'working' : null }])
      setActiveBy((a) => ({ ...a, [sc.key]: key }))
    },
    [scope, shellName]
  )
  const live$ = useRef({ start, scopes, scope, mine })
  live$.current = { start, scopes, scope, mine }

  useImperativeHandle(ref, () => ({
    start: async (profile, kind) => {
      const p = profile ?? defaultProfile(await loadSettings())
      const { start: go, scopes: all, scope: cur } = live$.current
      const sc = (kind && all.find((s) => s.kind === kind)) || cur
      if (kind) setPreferRepo(kind === 'repo')
      go(p, sc)
    },
    ensure: async () => {
      const s = await loadSettings()
      if (!live$.current.mine.length) live$.current.start(defaultProfile(s))
    }
  }), [loadSettings])

  // Sessions of a closed tab or workspace end with it.
  useEffect(() => {
    setSessions((s) => (s.some((x) => !live.includes(x.scope)) ? s.filter((x) => live.includes(x.scope)) : s))
  }, [live.join('\0')])

  const close = (key: number) => setSessions((s) => s.filter((x) => x.key !== key))
  const onExit = useCallback((key: number) => setSessions((s) => s.map((x) => (x.key === key ? { ...x, exited: true, ai: null } : x))), [])
  const onAi = useCallback((key: number, ai: AiState) => setSessions((s) => s.map((x) => (x.key === key && x.ai !== ai && !x.exited ? { ...x, ai } : x))), [])

  // Report the most urgent state per scope (repository or workspace).
  const aiKey = sessions.map((s) => `${s.scope}=${s.ai ?? ''}`).join('|')
  const onAiStatesRef = useRef(onAiStates)
  onAiStatesRef.current = onAiStates
  useEffect(() => {
    const out: Record<string, AiState> = {}
    for (const s of sessions) {
      const a = aggregateAi([out[s.scope], s.ai])
      if (a) out[s.scope] = a
    }
    onAiStatesRef.current(out, sessions.filter((s) => s.ai === 'working').length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiKey])

  const profiles = settings?.terminalProfiles.filter((p) => p.command.trim()) ?? []
  const choices = [{ ...SHELL, name: shellName }, ...profiles]
  const isDefault = (p: TerminalProfile) => (settings?.terminalDefault ?? '') === p.name || (!p.command && settings?.terminalDefault === 'Shell')

  return (
    <>
      <div
        className="resizer"
        style={open ? undefined : { display: 'none' }}
        onMouseDown={(e) => {
          const startX = e.clientX
          const startW = width
          let w = startW
          const move = (ev: MouseEvent) => {
            w = Math.min(Math.max(280, startW + startX - ev.clientX), window.innerWidth - 400)
            setWidth(w)
          }
          const up = () => {
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
            try {
              localStorage.setItem('odysseus.terminal.width', String(Math.round(w)))
            } catch {
              /* storage unavailable */
            }
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
      />
      <div className="term-pane" style={{ width, display: open ? undefined : 'none' }}>
        <div className="term-head">
          {scopes.length > 1 ? (
            <div className="term-scope" title="Where new sessions start">
              {scopes.map((s) => (
                <button key={s.key} className={s.key === scope?.key ? 'on' : ''} onClick={() => setPreferRepo(s.kind === 'repo')} title={s.cwd}>
                  {s.kind === 'workspace' ? 'Workspace' : 'Repository'}
                </button>
              ))}
            </div>
          ) : (
            scope && <span className="term-cwd ellipsis" title={scope.cwd}>{scope.label}</span>
          )}
          <span className="grow" />
          {settings && (
            <button className="btn small" disabled={!scope} onClick={() => start(defaultProfile(settings))} title={`Start ${defaultProfile(settings).name} in ${scope?.cwd ?? ''}`}>
              + {defaultProfile(settings).name}
            </button>
          )}
          <button
            className="btn small"
            disabled={!scope}
            title="Start another program here"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              ui.menu({ clientX: r.left, clientY: r.bottom + 2 }, choices.map((p) => ({ label: p.command ? `${p.name}  (${p.command})` : p.name, action: () => start(p) })))
            }}
          >
            ▾
          </button>
          <button className="btn small" onClick={onClose} title="Hide the pane (sessions keep running)">Hide</button>
        </div>
        {mine.length > 0 && (
          <div className="term-tabs">
            {mine.map((s) => (
              <div key={s.key} className={`term-tab ${s.key === active ? 'active' : ''} ${s.exited ? 'exited' : ''}`} onClick={() => scope && setActiveBy((a) => ({ ...a, [scope.key]: s.key }))} title={`${s.profile.command || s.title} in ${s.cwd}`}>
                {s.ai && <span className={`ai-dot ai-${s.ai}`} title={`${s.title}: ${AI_LABEL[s.ai]}`} />}
                <span className="ellipsis">{s.title}</span>
                <button className="term-x" onClick={(e) => { e.stopPropagation(); close(s.key) }} aria-label="Close session">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="term-body">
          {sessions.map((s) => (
            <TermView key={s.key} cwd={s.cwd} profile={s.profile} visible={open && s.scope === scope?.key && s.key === active} onExit={() => onExit(s.key)} onAi={s.profile.command ? (a) => onAi(s.key, a) : undefined} />
          ))}
          {mine.length === 0 && (
            <div className="term-empty">
              <div className="dim">{scope ? <>Start a session in <b>{scope.label}</b></> : 'Open a repository first'}</div>
              {scope &&
                choices.map((p) => (
                  <button key={p.name} className={`btn ${isDefault(p) ? 'primary' : ''}`} onClick={() => start(p)}>
                    {p.name}
                    {p.command && <code> {p.command}</code>}
                  </button>
                ))}
              <div className="faint" style={{ fontSize: 12 }}>Missing AI tools are installed the first time you start them. Pick the default in Settings.</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function TermView({ cwd, profile, visible, onExit, onAi }: { cwd: string; profile: TerminalProfile; visible: boolean; onExit(): void; onAi?(state: AiState): void }) {
  const host = useRef<HTMLDivElement>(null)
  const ref = useRef<{ term: Terminal; fit: FitAddon; id: number | null } | null>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const onAiRef = useRef(onAi)
  onAiRef.current = onAi

  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: xtermTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    const state = { term, fit, id: null as number | null }
    ref.current = state
    let disposed = false
    let pending = ''
    let lastOutputAt = Date.now()

    // Ctrl+C copies when text is selected; otherwise it interrupts like any terminal.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      // Let the browser paste into xterm's input (handled by its paste listener).
      if (mod && e.key.toLowerCase() === 'v') return false
      return true
    })

    const off = window.ody.on((ch, payload) => {
      const p = payload as { id: number; data?: string; code?: number }
      if (p.id !== state.id) return
      if (ch === 'termData') {
        term.write(p.data!)
        lastOutputAt = Date.now()
      }
      else if (ch === 'termExit') {
        term.write(`\r\n\x1b[2m[process exited with code ${p.code}]\x1b[0m\r\n`)
        state.id = null
        onExitRef.current()
      }
    })
    const input = term.onData((d) => {
      if (state.id !== null) api.termWrite(state.id, d)
      else pending += d
    })

    try {
      fit.fit()
    } catch {
      /* not laid out yet */
    }
    api
      .termCreate(cwd, term.cols, term.rows, profile)
      .then((id) => {
        if (disposed) return void api.termKill(id)
        state.id = id
        if (pending) api.termWrite(id, pending)
        pending = ''
      })
      .catch((e) => term.write(`\x1b[31m${(e as Error).message}\x1b[0m\r\n`))

    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetParent) return
      try {
        fit.fit()
        if (state.id !== null) api.termResize(state.id, term.cols, term.rows)
      } catch {
        /* hidden */
      }
    })
    ro.observe(host.current!)
    // AI sessions: read the screen a few times a second to tell working / needs you / idle.
    const watch = setInterval(() => {
      if (onAiRef.current && state.id !== null) onAiRef.current(detectAiState(visibleText(term), lastOutputAt))
    }, 600)
    const mo = new MutationObserver(() => (term.options.theme = xtermTheme()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      disposed = true
      clearInterval(watch)
      ro.disconnect()
      mo.disconnect()
      off()
      input.dispose()
      if (state.id !== null) api.termKill(state.id)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!visible || !ref.current) return
    const { term, fit } = ref.current
    requestAnimationFrame(() => {
      try {
        fit.fit()
        const id = ref.current?.id
        if (id != null) api.termResize(id, term.cols, term.rows)
      } catch {
        /* hidden */
      }
      term.focus()
    })
  }, [visible])

  return <div ref={host} className="term-view" style={visible ? undefined : { display: 'none' }} />
}
