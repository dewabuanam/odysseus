import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

export interface MenuItem {
  label: string
  action?: () => void
  danger?: boolean
  separator?: boolean
  disabled?: boolean
  /** Nested items, shown to the right on hover */
  submenu?: MenuItem[]
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    // Start listening only after the click that opened the menu has finished bubbling;
    // otherwise a menu opened by a left click (like the tab dropdown) closes instantly.
    const t = setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('blur', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
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
      {menu && <MenuList items={menu.items} x={menu.x} y={menu.y} onDone={() => setMenu(null)} />}
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

function MenuList({ items, x, y, onDone }: { items: MenuItem[]; x: number; y: number; onDone(): void }) {
  const [open, setOpen] = useState<number | null>(null)
  const [openTop, setOpenTop] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 6)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) })
  }, [x, y])
  return (
    <div className="ctx" ref={ref} style={pos} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <div
            key={i}
            className={`ctx-item ${it.danger ? 'danger' : ''} ${it.submenu ? 'has-sub' : ''} ${open === i ? 'open' : ''}`}
            style={it.disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
            onMouseEnter={(e) => {
              setOpen(it.submenu ? i : null)
              setOpenTop(e.currentTarget.offsetTop)
            }}
            onClick={() => {
              if (it.submenu) return setOpen(i)
              onDone()
              it.action?.()
            }}
          >
            <span className="grow">{it.label}</span>
            {it.submenu && <span className="ctx-arrow">›</span>}
            {it.submenu && open === i && (
              <MenuList items={it.submenu} x={pos.left + (ref.current?.offsetWidth ?? 200) - 4} y={pos.top + openTop - 4} onDone={onDone} />
            )}
          </div>
        )
      )}
    </div>
  )
}
