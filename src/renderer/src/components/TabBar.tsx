import { useEffect, useRef, useState } from 'react'
import type { RepoSummary } from '@shared/types'
import { norm, useRuns } from '../runs'
import { useUi } from '../ui'

const TAB_W = 168
const BUTTONS_W = 76

interface Props {
  tabs: RepoSummary[]
  active: string | null
  onSelect(path: string): void
  onClose(path: string): void
  onNew(): void
}

/**
 * Repository tabs on their own row. Only as many tabs as fit are shown; the rest live in the
 * ▾ menu to the left of +. The active tab is always visible.
 */
export function TabBar({ tabs, active, onSelect, onClose, onNew }: Props) {
  const ui = useUi()
  const runs = useRuns()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = Math.max(1, Math.floor((width - BUTTONS_W) / TAB_W))
  let visible = tabs.slice(0, fit)
  const activeTab = tabs.find((t) => t.path === active)
  if (activeTab && !visible.includes(activeTab)) visible = [...visible.slice(0, fit - 1), activeTab]
  const hidden = tabs.filter((t) => !visible.includes(t))
  const busy = (path: string) => runs.some((r) => norm(r.root) === norm(path) && r.endedAt === undefined)

  return (
    <div className="tabbar" ref={ref}>
      {visible.map((t) => (
        <div
          key={t.path}
          className={`tab ${t.path === active ? 'active' : ''}`}
          style={{ width: TAB_W }}
          title={t.path}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              onClose(t.path)
            }
          }}
          onClick={() => onSelect(t.path)}
        >
          {busy(t.path) && <span className="spinner tiny" />}
          <span className="ellipsis grow">{t.name}</span>
          <button
            className="tab-close"
            aria-label={`Close ${t.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onClose(t.path)
            }}
          >
            ×
          </button>
        </div>
      ))}
      {hidden.length > 0 && (
        <button
          className="tab-more"
          title={`${hidden.length} more open repositor${hidden.length === 1 ? 'y' : 'ies'}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            ui.menu({ clientX: r.left, clientY: r.bottom + 2 }, [
              ...hidden.map((t) => ({ label: `${busy(t.path) ? '● ' : ''}${t.name}`, action: () => onSelect(t.path) })),
              { separator: true, label: '' },
              { label: `Close ${hidden.length} hidden tab${hidden.length === 1 ? '' : 's'}`, danger: true, action: () => hidden.forEach((t) => onClose(t.path)) }
            ])
          }}
        >
          ▾ <span className="tab-more-count">{hidden.length}</span>
        </button>
      )}
      <button className="tab-new" onClick={onNew} title="Open repository in a new tab">
        +
      </button>
      <div className="tabbar-fill" />
    </div>
  )
}
