import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseAnsi } from './ansi'

// ------------------------------------------------------------------ dialogs

export interface AskOptions {
  title: string
  message?: ReactNode
  input?: { label?: string; value?: string; placeholder?: string; multiline?: boolean }
  checkbox?: { label: string; checked?: boolean }
  confirmLabel?: string
  danger?: boolean
}

export interface AskResult {
  value: string
  checked: boolean
}

interface MenuItem {
  label: string
  action?: () => void
  danger?: boolean
  separator?: boolean
  disabled?: boolean
}

interface UiApi {
  ask(o: AskOptions): Promise<AskResult | null>
  toast(msg: string, error?: boolean): void
  menu(e: { clientX: number; clientY: number }, items: MenuItem[]): void
}

const UiContext = createContext<UiApi | null>(null)

export function useUi(): UiApi {
  const ctx = useContext(UiContext)
  if (!ctx) throw new Error('UiProvider missing')
  return ctx
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(AskOptions & { resolve: (r: AskResult | null) => void }) | null>(null)
  const [toasts, setToasts] = useState<{ id: number; msg: string; error: boolean }[]>([])
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const api: UiApi = useMemo(() => ({
    ask: (o) => new Promise((resolve) => setDialog({ ...o, resolve })),
    toast: (msg, error = false) => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t, { id, msg, error }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 7000 : 3000)
    },
    menu: (e, items) => setMenu({ x: e.clientX, y: e.clientY, items })
  }), [])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  return (
    <UiContext.Provider value={api}>
      {children}
      {dialog && (
        <AskDialog
          opts={dialog}
          onClose={(r) => {
            dialog.resolve(r)
            setDialog(null)
          }}
        />
      )}
      {menu && (
        <div
          className="ctx"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - menu.items.length * 30 - 10) }}
        >
          {menu.items.map((it, i) =>
            it.separator ? (
              <div key={i} className="ctx-sep" />
            ) : (
              <div
                key={i}
                className={`ctx-item ${it.danger ? 'danger' : ''}`}
                style={it.disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
                onClick={() => {
                  setMenu(null)
                  it.action?.()
                }}
              >
                {it.label}
              </div>
            )
          )}
        </div>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </UiContext.Provider>
  )
}

function AskDialog({ opts, onClose }: { opts: AskOptions; onClose: (r: AskResult | null) => void }) {
  const [value, setValue] = useState(opts.input?.value ?? '')
  const [checked, setChecked] = useState(opts.checkbox?.checked ?? false)
  const submit = () => {
    if (opts.input && !value.trim()) return
    onClose({ value: value.trim(), checked })
  }
  return (
    <Modal onClose={() => onClose(null)}>
      <h3>{opts.title}</h3>
      {opts.message && <div className="dim" style={{ marginBottom: 10 }}>{opts.message}</div>}
      {opts.input && (
        <div className="field">
          {opts.input.label && <span>{opts.input.label}</span>}
          {opts.input.multiline ? (
            <textarea className="textarea" rows={4} autoFocus value={value} placeholder={opts.input.placeholder} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input
              className="input"
              autoFocus
              value={value}
              placeholder={opts.input.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          )}
        </div>
      )}
      {opts.checkbox && (
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {opts.checkbox.label}
        </label>
      )}
      <div className="buttons">
        <button className="btn" onClick={() => onClose(null)}>
          Cancel
        </button>
        <button className={`btn ${opts.danger ? 'danger' : 'primary'}`} autoFocus={!opts.input} onClick={submit}>
          {opts.confirmLabel ?? 'OK'}
        </button>
      </div>
    </Modal>
  )
}

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  )
}

// ------------------------------------------------------------------ misc

export function Ansi({ text }: { text: string }) {
  return (
    <>
      {parseAnsi(text).map((s, i) => (
        <span
          key={i}
          style={{
            color: s.fg,
            background: s.bg,
            fontWeight: s.bold ? 700 : undefined,
            opacity: s.dim ? 0.65 : undefined,
            textDecoration: s.underline ? 'underline' : undefined
          }}
        >
          {s.text}
        </span>
      ))}
    </>
  )
}

export function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

export function fmtDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function useTicker(active: boolean, interval = 200): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [active, interval])
  return now
}

export const HOOK_DOCS: Record<string, string> = {
  'pre-commit': 'Runs before the commit is created. Lint / format / test staged files.',
  'prepare-commit-msg': 'Edits the default commit message before the editor opens (e.g. prefix ticket id).',
  'commit-msg': 'Validates the commit message (e.g. conventional commits).',
  'post-commit': 'Runs after a commit is created. Notifications only.',
  'pre-push': 'Runs before pushing. Tests, build checks, protected-branch guards.',
  'pre-merge-commit': 'Runs before a merge commit is created.',
  'post-merge': 'Runs after a merge / pull. E.g. reinstall dependencies.',
  'post-checkout': 'Runs after checkout / switch. E.g. rebuild, clean caches.',
  'pre-rebase': 'Runs before a rebase starts; can refuse the rebase.',
  'post-rewrite': 'Runs after commits are rewritten (amend, rebase).',
  'applypatch-msg': 'Validates a patch commit message (git am).',
  'pre-applypatch': 'Runs after a patch is applied but before committing (git am).',
  'post-applypatch': 'Runs after a patch is committed (git am).',
  'pre-auto-gc': 'Runs before automatic garbage collection.',
  'reference-transaction': 'Runs on every ref update transaction.',
  'push-to-checkout': 'Server side: handles pushes to a checked-out branch.'
}

export const HOOK_TEMPLATE = (name: string) => `#!/bin/sh
# ${name} hook: ${HOOK_DOCS[name] ?? ''}
# Exit with a non-zero status to abort.

echo "Running ${name}…"

exit 0
`
