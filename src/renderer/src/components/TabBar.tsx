import { useEffect, useRef, useState } from 'react'
import type { AiState, RepoSummary, Workspace } from '@shared/types'
import { AI_LABEL } from '../aiState'
import { norm, useRuns } from '../runs'
import { useUi } from '../ui'
import { barItems, type BarItem, type DragItem, type DropTarget } from '../workspaces'

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
  /** A tab or a group's chip was dragged and dropped beside another tab or chip */
  onDrop(drag: DragItem, target: DropTarget): void
  /** Workspace ids the user collapsed; the others stay expanded */
  collapsed: string[]
  /** A collapsed group's chip was clicked: expand it and switch to that group */
  onOpenGroup(w: Workspace): void
  /** An expanded group's chip was clicked: collapse it (leaving no tab focused if it held the active one) */
  onCollapseGroup(w: Workspace): void
  onGroupMenu(e: React.MouseEvent, w: Workspace): void
  onTabMenu(e: React.MouseEvent, path: string): void
  /** AI status of a repository's sessions, and of a group (its folder's and its tabs' sessions) */
  repoAi(path: string): AiState | null
  groupAi(w: Workspace): AiState | null
}

const AiDot = ({ state }: { state: AiState | null }) => (state ? <span className={`ai-dot ai-${state}`} title={`AI ${AI_LABEL[state]}`} /> : null)

/**
 * Repository tabs on their own row, grouped like browser tab groups: each workspace is a
 * colored chip. Groups stay expanded until their chip is clicked to collapse them. Tabs that don't fit live in the ▾ menu; the active tab is always visible.
 * Tabs and chips drag to reorder; a dragged chip carries its whole group.
 */
export function TabBar({ tabs, active, workspaces, collapsed, onSelect, onClose, onNew, onDrop, onOpenGroup, onCollapseGroup, onGroupMenu, onTabMenu, repoAi, groupAi }: Props) {
  const ui = useUi()
  const runs = useRuns()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [over, setOver] = useState<DropTarget | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const items = barItems(tabs, workspaces, active, collapsed)
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

  /** Drag and drop handlers for one tab or chip; `at` builds the drop target from the pointer's side. */
  const dnd = (item: DragItem, at: (before: boolean) => DropTarget) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', item.kind === 'tab' ? item.path : item.id)
      setDrag(item)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!drag) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      const r = e.currentTarget.getBoundingClientRect()
      const t = at(e.clientX < r.left + r.width / 2)
      if (!over || key(over) !== key(t) || over.before !== t.before) setOver(t)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      if (drag) onDrop(drag, at(e.clientX < r.left + r.width / 2))
      setDrag(null)
      setOver(null)
    },
    onDragEnd: () => {
      setDrag(null)
      setOver(null)
    }
  })
  const key = (i: DragItem | DropTarget) => (i.kind === 'tab' ? `t:${i.path}` : `g:${i.id}`)
  const dragClass = (i: DragItem) => `${over && key(over) === key(i) ? (over.before ? 'drop-before' : 'drop-after') : ''} ${drag && key(drag) === key(i) ? 'dragging' : ''}`

  const renderItem = (item: BarItem) =>
    item.kind === 'group' ? (
      <div
        key={`g:${item.ws.id}`}
        className={`tab-group ${item.open ? 'open' : ''} ${dragClass({ kind: 'group', id: item.ws.id })}`}
        {...dnd({ kind: 'group', id: item.ws.id }, (before) => ({ kind: 'group', id: item.ws.id, before, open: item.open }))}
        style={{ '--group': `var(--lane-${item.ws.color})`, maxWidth: chipWidth(item.ws) } as React.CSSProperties}
        title={`${item.ws.name}: ${item.ws.repos.length} tab${item.ws.repos.length === 1 ? '' : 's'}\n${item.ws.folder}${item.open ? '\nClick to collapse' : '\nClick to open this workspace'}`}
        onClick={() => (item.open ? onCollapseGroup(item.ws) : onOpenGroup(item.ws))}
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
        className={`tab ${item.tab.path === active ? 'active' : ''} ${item.ws ? 'grouped' : ''} ${dragClass({ kind: 'tab', path: item.tab.path })}`}
        {...dnd({ kind: 'tab', path: item.tab.path }, (before) => ({ kind: 'tab', path: item.tab.path, before }))}
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

  // An open group is drawn as one tinted box holding its chip and its tabs.
  const segments: { box?: Workspace; items: BarItem[] }[] = []
  for (const item of visible) {
    const last = segments[segments.length - 1]
    if (item.kind === 'group' && item.open) segments.push({ box: item.ws, items: [item] })
    else if (item.kind === 'tab' && item.ws && last?.box?.id === item.ws.id) last.items.push(item)
    else segments.push({ items: [item] })
  }

  return (
    <div className="tabbar" ref={ref}>
      {segments.map((seg) =>
        seg.box ? (
          <div key={`box:${seg.box.id}`} className="tab-group-box" style={{ '--group': `var(--lane-${seg.box.color})` } as React.CSSProperties}>
            {seg.items.map(renderItem)}
          </div>
        ) : (
          seg.items.map(renderItem)
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
