import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { aggregateAi, programOf, remoteControlFor, type AiPaneState, type AiState, type Settings, type TerminalProfile } from '@shared/types'
import { AI_LABEL, detectAiState, detectShellState, visibleText } from '../aiState'
import { api } from '../api'
import { useUi } from '../ui'
import { RemoteControlDialog } from './RemoteControlDialog'

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
  /** Types `text` into the default AI here (starting it if needed) once it is ready for input. */
  send(text: string): void
  /** Turns Remote Control on or off for the repository or workspace in view, introducing it the first time. */
  toggleRemote(): void
  /** Turns the default Remote Control for every repository and workspace on or off. */
  toggleRemoteDefault(): void
  /** Every open session, in every repository and workspace. */
  sessions(): OpenSession[]
  /** Brings a session into view; its repository or workspace must be the one open. */
  focus(key: number): void
}

/** An open session as the rest of the app sees it. */
export interface OpenSession {
  key: number
  title: string
  /** The scope key it runs in: `repo:<path>` or `ws:<id>` */
  scope: string
  shell: boolean
  ai: AiState | null
  exited: boolean
}

interface Session {
  key: number
  /** Stable id, saved with the pane; Claude Code also uses it as the conversation id to resume */
  sid: string
  scope: string
  cwd: string
  title: string
  profile: TerminalProfile
  exited: boolean
  /** What the program is doing: an AI, or the command running in a shell */
  ai: AiState | null
  /** Started ahead of time in the background; becomes a real session when the AI is opened */
  spare?: boolean
  /** Claude Code with Remote Control on */
  remote?: boolean
}

const SHELL: TerminalProfile = { name: 'Shell', command: '' }
let nextKey = 1

/** A random UUID (v4), the form Claude Code takes for a conversation id. */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

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

/** Only Claude Code has Remote Control. */
export const hasRemote = (p: TerminalProfile) => programOf(p.command) === 'claude'

/** The name a remote session shows in the Claude session list: the repository or workspace. */
const remoteName = (label: string) => label.replace(/[^\w .-]/g, '').trim()

/** The profile as started in `label`: with `--remote-control` when that's on and it's Claude Code. */
function withRemote(p: TerminalProfile, on: boolean, label: string): TerminalProfile {
  if (!on || !hasRemote(p) || /\s--(remote-control|rc)\b/.test(p.command)) return p
  const name = remoteName(label)
  return { ...p, command: `${p.command.trim()} --remote-control${name ? ` "${name}"` : ''}` }
}

interface Props {
  /** Scopes available for the active tab: its workspace (if any) first, then the repository */
  scopes: TermScope[]
  /** Scope keys still open; sessions of any other scope are ended */
  live: string[]
  /** Tabs and workspaces are loaded: the sessions saved for the ones still open come back */
  ready: boolean
  open: boolean
  /** The pane is switched on (it may still be hidden, on the start page); saved for the next launch */
  wanted?: boolean
  onClose(): void
  /** Most urgent AI state per scope key, and how many sessions are working, on every change */
  onAiStates(states: Record<string, AiState>, working: number): void
  /** Settings as the app last saw them; a change reloads the pane's copy */
  appSettings?: Settings | null
  /** The pane changed a setting (Remote Control) */
  onSettings?(s: Settings): void
  ref?: Ref<TerminalHandle>
}

/**
 * Right-hand pane with real terminals: a shell, or an AI CLI such as Claude Code, started in the
 * repository or its workspace folder. Sessions keep running while the pane is hidden, and come
 * back on the next launch (Claude Code resuming each one's own conversation).
 */
export function TerminalPane({ scopes, live, ready, open, wanted = open, onClose, onAiStates, appSettings, onSettings, ref }: Props) {
  const ui = useUi()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeBy, setActiveBy] = useState<Record<string, number>>({})
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shellName, setShellName] = useState('Shell')
  const [preferRepo, setPreferRepo] = useState(false)
  const [remoteIntro, setRemoteIntro] = useState(false)
  /** Text waiting to be typed into a session once it is ready for input, by session key */
  const outbox = useRef(new Map<number, string[]>())
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('odysseus.terminal.width')) || 560
    } catch {
      return 560
    }
  })

  const scope = (preferRepo && scopes.find((s) => s.kind === 'repo')) || scopes[0] || null
  const mine = sessions.filter((s) => s.scope === scope?.key && !s.spare)
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
    loadSettings()
  }, [open, appSettings, loadSettings])

  const remoteFor = (key: string) => !!settings && remoteControlFor(settings, key)
  const remoteOn = !!scope && remoteFor(scope.key)
  /** The scope in view sets Remote Control itself instead of following the default */
  const remoteOwn = !!scope && settings?.remoteControlScopes?.[scope.key] !== undefined
  const start = useCallback(
    (base: TerminalProfile, sc: TermScope | null = scope): number | undefined => {
      if (!sc) return
      const profile = withRemote(base, remoteFor(sc.key), sc.label)
      // An AI started ahead of time for this place opens instantly instead of booting now.
      const spare = sessions.find((x) => x.spare && !x.exited && x.scope === sc.key && x.profile.name === profile.name && x.profile.command === profile.command)
      if (spare) {
        setSessions((s) => s.map((x) => (x.key === spare.key ? { ...x, spare: false } : x)))
        setActiveBy((a) => ({ ...a, [sc.key]: spare.key }))
        return spare.key
      }
      const key = nextKey++
      const remote = profile !== base
      setSessions((s) => [...s, { key, sid: uuid(), scope: sc.key, cwd: sc.cwd, title: profile.command ? base.name : shellName, profile, exited: false, ai: profile.command ? 'working' : 'idle', remote }])
      setActiveBy((a) => ({ ...a, [sc.key]: key }))
      return key
    },
    [scope, shellName, sessions, settings]
  )

  const queue = (key: number, text: string) => outbox.current.set(key, [...(outbox.current.get(key) ?? []), text])

  /**
   * Saves Remote Control as the default (`'all'`) or for one repository or workspace, and turns
   * it on in the Claude Code sessions already open that it now covers, by typing /remote-control
   * into each once it is ready for input. Open sessions keep it when it is turned off.
   */
  const setRemote = async (on: boolean, target: TermScope | 'all') => {
    setRemoteIntro(false)
    const cur = await loadSettings()
    const scopesMap = { ...(cur.remoteControlScopes ?? {}) }
    if (target !== 'all') {
      // Matching the default again means following it, so a later default change applies here too.
      if (on === cur.remoteControl) delete scopesMap[target.key]
      else scopesMap[target.key] = { on, label: target.label }
    }
    const patch: Partial<Settings> = target === 'all' ? { remoteControl: on } : { remoteControlScopes: scopesMap }
    const saved = await api.setSettings({ ...patch, remoteControlSetup: true })
    setSettings(saved)
    onSettings?.(saved)
    const where = target === 'all' ? 'by default' : `for ${target.label}`
    if (!on) {
      const kept = sessions.some((x) => !x.spare && !x.exited && x.remote && (target === 'all' || x.scope === target.key) && !remoteControlFor(saved, x.scope))
      return ui.toast(`Remote Control is off ${where}${kept ? '. Open sessions keep it until you close them.' : ''}`)
    }
    const targets = sessions.filter((x) => !x.spare && !x.exited && !x.remote && hasRemote(x.profile) && remoteControlFor(saved, x.scope))
    for (const t of targets) {
      const name = remoteName(scopes.find((x) => x.key === t.scope)?.label ?? t.cwd.split(/[\\/]/).filter(Boolean).pop() ?? '')
      queue(t.key, `/remote-control${name ? ` ${name}` : ''}`)
    }
    if (targets.length) setSessions((s) => s.map((x) => (targets.some((t) => t.key === x.key) ? { ...x, remote: true } : x)))
    const n = targets.length
    ui.toast(`Remote Control is on ${where}${n ? ` (also for ${n} open session${n > 1 ? 's' : ''})` : ''}`)
  }

  const toggleRemote = async () => {
    const s = await loadSettings()
    if (!scope) return
    if (!s.remoteControlSetup) return setRemoteIntro(true)
    setRemote(!remoteControlFor(s, scope.key), scope)
  }

  const toggleRemoteDefault = async () => {
    const s = await loadSettings()
    if (!s.remoteControlSetup) return setRemoteIntro(true)
    setRemote(!s.remoteControl, 'all')
  }

  // AI CLIs take seconds to boot (Claude Code about 4 to 5). Keep one copy of the default AI
  // starting in the background for the repository or workspace in view, so opening it is
  // instant. Only one spare exists at a time; moving elsewhere replaces it.
  const prewarm = settings?.terminalPrewarm !== false && settings && scope ? withRemote(defaultProfile(settings), remoteOn, scope.label) : null
  useEffect(() => {
    if (!scope || !prewarm?.command.trim()) {
      setSessions((s) => (s.some((x) => x.spare) ? s.filter((x) => !x.spare) : s))
      return
    }
    const t = setTimeout(() => {
      setSessions((s) => {
        const keep = s.filter((x) => !x.spare || (x.scope === scope.key && x.profile.command === prewarm.command && !x.exited))
        const busy = keep.some((x) => x.scope === scope.key)
        if (busy) return keep.length === s.length ? s : keep
        return [...keep, { key: nextKey++, sid: uuid(), scope: scope.key, cwd: scope.cwd, title: prewarm.name, profile: prewarm, exited: false, ai: null, spare: true, remote: remoteOn && hasRemote(prewarm) }]
      })
    }, 2500)
    return () => clearTimeout(t)
  }, [scope?.key, scope?.cwd, prewarm?.name, prewarm?.command])
  const live$ = useRef({ start, scopes, scope, mine, active, sessions, toggleRemote, toggleRemoteDefault })
  live$.current = { start, scopes, scope, mine, active, sessions, toggleRemote, toggleRemoteDefault }

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
    },
    send: async (text) => {
      const p = defaultProfile(await loadSettings())
      if (!p.command.trim()) return void ui.toast('Pick a default AI first (Preferences: Default AI)', true)
      const { start: go, scope: cur, mine: here, active: act } = live$.current
      if (!cur) return
      // The AI in view if it runs the default program, else the newest one here, else a new one.
      const same = here.filter((x) => !x.exited && programOf(x.profile.command) === programOf(p.command))
      const target = same.find((x) => x.key === act) ?? same[same.length - 1]
      if (target) setActiveBy((a) => ({ ...a, [cur.key]: target.key }))
      const key = target?.key ?? go(p, cur)
      if (key !== undefined) queue(key, text)
    },
    toggleRemote: () => live$.current.toggleRemote(),
    toggleRemoteDefault: () => live$.current.toggleRemoteDefault(),
    sessions: () =>
      live$.current.sessions.filter((x) => !x.spare).map((x) => ({ key: x.key, title: x.title, scope: x.scope, shell: !x.profile.command, ai: x.ai, exited: x.exited })),
    focus: (key) => {
      const s = live$.current.sessions.find((x) => x.key === key)
      if (!s) return
      setPreferRepo(s.scope.startsWith('repo:'))
      setActiveBy((a) => ({ ...a, [s.scope]: key }))
    }
  }), [loadSettings])

  // The sessions left open last time, for the repositories and workspaces still open.
  const restored = useRef(false)
  useEffect(() => {
    if (!ready || restored.current) return
    api.getAiPane().then(
      (saved) => {
        const back: Session[] = saved.sessions.filter((x) => live.includes(x.scope)).map((x) => ({ ...x, key: nextKey++, sid: x.id, exited: false, ai: x.profile.command ? 'working' : 'idle' }))
        const act: Record<string, number> = {}
        for (const [sc, id] of Object.entries(saved.active)) {
          const k = back.find((x) => x.sid === id && x.scope === sc)?.key
          if (k !== undefined) act[sc] = k
        }
        // A spare started meanwhile isn't needed where sessions came back.
        setSessions((s) => [...s.filter((x) => !x.spare || !back.some((b) => b.scope === x.scope)), ...back])
        setActiveBy((a) => ({ ...act, ...a }))
        restored.current = true
      },
      () => (restored.current = true)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // Save the pane as it is whenever its sessions, the one in view, or its visibility change.
  const saved = sessions.filter((x) => !x.spare && !x.exited)
  const saveKey = JSON.stringify([wanted, saved.map((x) => [x.sid, x.scope, x.title, x.remote]), activeBy])
  useEffect(() => {
    if (!restored.current) return
    const active: Record<string, string> = {}
    for (const [sc, k] of Object.entries(activeBy)) {
      const sid = saved.find((x) => x.key === k)?.sid
      if (sid) active[sc] = sid
    }
    const pane: AiPaneState = { open: wanted, active, sessions: saved.map((x) => ({ id: x.sid, scope: x.scope, cwd: x.cwd, title: x.title, profile: x.profile, remote: x.remote })) }
    api.setAiPane(pane).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveKey, restored.current])

  // Sessions of a closed tab or workspace end with it.
  useEffect(() => {
    if (!ready) return
    setSessions((s) => (s.some((x) => !live.includes(x.scope)) ? s.filter((x) => live.includes(x.scope)) : s))
  }, [live.join('\0'), ready])

  const close = (key: number) => {
    outbox.current.delete(key)
    setSessions((s) => s.filter((x) => x.key !== key))
  }
  const onExit = useCallback((key: number) => setSessions((s) => s.map((x) => (x.key === key ? { ...x, exited: true, ai: null } : x))), [])
  const onAi = useCallback((key: number, ai: AiState) => setSessions((s) => s.map((x) => (x.key === key && x.ai !== ai && !x.exited ? { ...x, ai } : x))), [])

  // Report the most urgent state per scope (repository or workspace).
  const aiKey = sessions.map((s) => `${s.scope}=${s.spare ? '' : s.ai ?? ''}`).join('|')
  const onAiStatesRef = useRef(onAiStates)
  onAiStatesRef.current = onAiStates
  useEffect(() => {
    const out: Record<string, AiState> = {}
    for (const s of sessions) {
      if (s.spare) continue
      const a = aggregateAi([out[s.scope], s.ai])
      if (a) out[s.scope] = a
    }
    onAiStatesRef.current(out, sessions.filter((s) => !s.spare && s.ai === 'working').length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiKey])

  /** Most urgent state of a repository's or workspace's sessions, for its dot in the header */
  const scopeAi = (key: string) => aggregateAi(sessions.filter((x) => x.scope === key && !x.spare).map((x) => x.ai))
  const ScopeDot = ({ k }: { k: string }) => {
    const a = scopeAi(k)
    return a ? <span className={`ai-dot ai-${a}`} title={`Sessions here: ${AI_LABEL[a]}`} /> : null
  }

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
                  <ScopeDot k={s.key} />
                  {s.kind === 'workspace' ? 'Workspace' : 'Repository'}
                </button>
              ))}
            </div>
          ) : (
            scope && (
              <span className="term-cwd" title={scope.cwd}>
                <ScopeDot k={scope.key} />
                <span className="ellipsis">{scope.label}</span>
              </span>
            )
          )}
          <span className="grow" />
          {settings && (hasRemote(defaultProfile(settings)) || mine.some((x) => hasRemote(x.profile))) && (
            <button
              className={`btn small remote-toggle ${remoteOn ? 'on' : ''}`}
              onClick={() => toggleRemote()}
              title={`${remoteOn ? `Remote Control is on for ${scope?.label}: Claude Code sessions can be continued from claude.ai or the Claude app` : `Remote Control is off for ${scope?.label}`}${remoteOwn ? '' : ' (the default)'}. Click to turn it ${remoteOn ? 'off' : 'on'} here.`}
            >
              <span className="remote-dot" />
              Remote
            </button>
          )}
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
                {s.remote && !s.exited && <span className="term-remote" title="Remote Control is on: continue this session from claude.ai or the Claude app">remote</span>}
                <button className="term-x" onClick={(e) => { e.stopPropagation(); close(s.key) }} aria-label="Close session">×</button>
              </div>
            ))}
          </div>
        )}
        <div className="term-body">
          {sessions.map((s) => (
            <TermView key={s.key} cwd={s.cwd} profile={s.profile} sessionId={s.sid} visible={open && s.scope === scope?.key && s.key === active} onExit={() => onExit(s.key)} shell={!s.profile.command} onAi={(a) => onAi(s.key, a)} pull={() => outbox.current.get(s.key)?.shift()} />
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
      {remoteIntro && <RemoteControlDialog label={scope?.label ?? null} onClose={() => setRemoteIntro(false)} onEnable={(every) => setRemote(true, every || !scope ? 'all' : scope)} />}
    </>
  )
}

interface TermViewProps {
  cwd: string
  profile: TerminalProfile
  /** Conversation id for Claude Code: started with it the first time, resumed after that */
  sessionId?: string
  visible: boolean
  /** A plain shell: its state comes from its prompt instead of an AI's screen */
  shell?: boolean
  onExit(): void
  onAi?(state: AiState): void
  /** Next text to type in once the program is ready for input */
  pull?(): string | undefined
}

function TermView({ cwd, profile, sessionId, visible, shell, onExit, onAi, pull }: TermViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const ref = useRef<{ term: Terminal; fit: FitAddon; id: number | null } | null>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const onAiRef = useRef(onAi)
  onAiRef.current = onAi
  const pullRef = useRef(pull)
  pullRef.current = pull

  useEffect(() => {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'Consolas, monospace',
      fontSize: 13,
      cursorBlink: false,
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
    /** A shell has run a command: until then it is idle, whatever it prints while starting */
    let ran = false

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
      if (d.includes('\r')) ran = true
      if (state.id !== null) api.termWrite(state.id, d)
      else pending += d
    })

    try {
      fit.fit()
    } catch {
      /* not laid out yet */
    }
    api
      .termCreate(cwd, term.cols, term.rows, profile, sessionId)
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
    // Read the screen a few times a second to tell working / needs you / idle: an AI from its
    // own cues, a shell from whether it sits at its prompt.
    // Queued text (a slash command from the palette) is typed in once the AI sits idle at its
    // prompt, so it isn't lost while the program boots or asks something first.
    const watch = setInterval(() => {
      if (!onAiRef.current || state.id === null) return
      if (shell) return onAiRef.current(detectShellState(term, ran))
      const ai = detectAiState(visibleText(term), lastOutputAt)
      onAiRef.current(ai)
      const text = ai === 'idle' ? pullRef.current?.() : undefined
      if (text) {
        const id = state.id
        api.termWrite(id, text)
        // Enter on its own, so the CLI doesn't take it as part of pasted text.
        setTimeout(() => state.id === id && api.termWrite(id, '\r'), 150)
        lastOutputAt = Date.now()
      }
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
