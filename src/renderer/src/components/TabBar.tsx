import { useEffect, useRef, useState } from 'react'
import type { AiState, RepoSummary, Workspace } from '@shared/types'
import { AI_LABEL } from '../aiState'
import { norm, useRuns } from '../runs'
import { useUi } from '../ui'
import { barItems, type BarItem } from '../workspaces'

const TAB_W = 168
const BUTTONS_W = 76
const chipWidth = (w: Workspace) => Math.min(162, 38 + w.name.length * 7.2)

interface Props {
  tabs: RepoSummary[]
  active: string | null
  workspaces: Workspace[]
  onSelect(path: string): void
  onClose(path: string): void
  onNew(): void
  /** Move a tab to a new position in the tab order */
  onMove(path: string, index: number): void
  /** A collapsed group's chip was clicked: switch to that group */
  onOpenGroup(w: Workspace): void
  onGroupMenu(e: React.MouseEvent, w: Workspace): void
  onTabMenu(e: React.MouseEvent, path: string): void
  /** AI status of a repository's sessions, and of a group (its folder's and its tabs' sessions) */
  repoAi(path: string): AiState | null
  groupAi(w: Workspace): AiState | null
}

const AiDot = ({ state }: { state: AiState | null }) => (state ? <span className={`ai-dot ai-${state}`} title={`AI ${AI_LABEL[state]}`} /> : null)

/**
 * Repository tabs on their own row, grouped like browser tab groups: each workspace is a
 * colored chip. Only the group holding the active tab is expanded; the others show just their
 * chip. Tabs that don't fit live in the ▾ menu; the active tab is always visible.
 */
export function TabBar({ tabs, active, workspaces, onSelect, onClose, onNew, onOpenGroup, onGroupMenu, onTabMenu, repoAi, groupAi }: Props) {
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

  const items = barItems(tabs, workspaces, active)
  const itemW = (i: BarItem) => (i.kind === 'group' ? chipWidth(i.ws) : TAB_W)
  const budget = width - BUTTONS_W
  let fit = 0
  for (let used = 0; fit < items.length && used + itemW(items[fit]) <= budget; fit++) used += itemW(items[fit])
  fit = Math.max(1, fit)
  let visible = items.slice(0, fit)
  let hidden = items.slice(fit)
  // The active tab always shows: it takes the last visible slot.
  const activeAt = items.findIndex((i) => i.kind === 'tab' && i.tab.path === active)
  if (activeAt >= fit) {
    const last = visible[visible.length - 1]
    visible = [...visible.slice(0, -1), items[activeAt]]
    hidden = [last, ...hidden.filter((i) => i !== items[activeAt])]
  }

  const busy = (path: string) => runs.some((r) => norm(r.root) === norm(path) && r.endedAt === undefined)
  const groupBusy = (w: Workspace) => w.repos.some(busy)

  return (
    <div className="tabbar" ref={ref}>
      {visible.map((item) =>
        item.kind === 'group' ? (
          <div
            key={`g:${item.ws.id}`}
            className={`tab-group ${item.open ? 'open' : ''}`}
            style={{ '--group': `var(--lane-${item.ws.color})`, maxWidth: chipWidth(item.ws) } as React.CSSProperties}
            title={`${item.ws.name}: ${item.ws.repos.length} tab${item.ws.repos.length === 1 ? '' : 's'}\n${item.ws.folder}${item.open ? '' : '\nClick to open this workspace'}`}
            onClick={() => !item.open && onOpenGroup(item.ws)}
            onContextMenu={(e) => {
              e.preventDefault()
              onGroupMenu(e, item.ws)
            }}
          >
            {!item.open && groupBusy(item.ws) && <span className="spinner tiny" />}
            <AiDot state={groupAi(item.ws)} />
            <span className="ellipsis">{item.ws.name}</span>
          </div>
        ) : (
          <div
            key={item.tab.path}
            className={`tab ${item.tab.path === active ? 'active' : ''} ${item.ws ? 'grouped' : ''}`}
            style={{ width: TAB_W, ...(item.ws ? ({ '--group': `var(--lane-${item.ws.color})` } as React.CSSProperties) : {}) }}
            title={item.tab.path}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                onClose(item.tab.path)
              }
            }}
            onClick={() => onSelect(item.tab.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              onTabMenu(e, item.tab.path)
            }}
          >
            {busy(item.tab.path) && <span className="spinner tiny" />}
            <AiDot state={repoAi(item.tab.path)} />
            <span className="ellipsis grow">{item.tab.name}</span>
            <button
              className="tab-close"
              aria-label={`Close ${item.tab.name}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(item.tab.path)
              }}
            >
              ×
            </button>
          </div>
        )
      )}
      {hidden.length > 0 && (
        <button
          className="tab-more"
          title={`${hidden.length} more`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const hiddenTabs = hidden.flatMap((i) => (i.kind === 'tab' ? [i.tab] : []))
            ui.menu({ clientX: r.left, clientY: r.bottom + 2 }, [
              ...hidden.map((i) =>
                i.kind === 'group'
                  ? { label: `▣ ${i.ws.name} (${i.ws.repos.length})`, action: () => onOpenGroup(i.ws) }
                  : { label: `${busy(i.tab.path) ? '● ' : ''}${i.tab.name}`, action: () => onSelect(i.tab.path) }
              ),
              ...(hiddenTabs.length
                ? [
                    { separator: true, label: '' },
                    { label: `Close ${hiddenTabs.length} hidden tab${hiddenTabs.length === 1 ? '' : 's'}`, danger: true, action: () => hiddenTabs.forEach((t) => onClose(t.path)) }
                  ]
                : [])
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
