import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AiState, RepoSummary, Workspace } from '@shared/types'
import { AI_LABEL } from '../aiState'
import { norm, useRuns } from '../runs'
import { useUi } from '../ui'
import { addRepos, barItems, dropInBar, withoutRepos, wsOf, type BarItem, type DragItem, type DropTarget } from '../workspaces'

const TAB_W = 168
const BUTTONS_W = 76
const chipWidth = (w: Workspace) => Math.min(162, 38 + w.name.length * 7.2)

interface Props {
  tabs: RepoSummary[]
  active: string | null
  workspaces: Workspace[]
  onSelect(path: string): void
  onClose(path: string): void
  /** The + button: a menu at the given point (new or open repository, new workspace) */
  onNew(e: { clientX: number; clientY: number }): void
  /** A tab or a group was dragged to a new place: the new tab order and groups */
  onReorder(tabs: RepoSummary[], workspaces: Workspace[]): void
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

const AiDot = ({ state }: { state: AiState | null }) => (state ? <span className={`ai-dot ai-${state}`} title={`Sessions: ${AI_LABEL[state]}`} /> : null)

/** Left edge of an element in the tab row, ignoring transforms: where it sits, not where it is drawn. */
function slotLeft(el: HTMLElement, bar: HTMLElement): number {
  let x = 0
  for (let n: HTMLElement | null = el; n && n !== bar; n = n.offsetParent as HTMLElement | null) x += n.offsetLeft
  return x
}

/** How far an element's transform currently draws it from its slot (mid animation). */
function drawnOffset(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  return t && t !== 'none' ? new DOMMatrixReadOnly(t).m41 : 0
}

/** Slides an element from `from` pixels away back into its slot. */
function slide(el: HTMLElement, from: number): void {
  el.style.transition = 'none'
  el.style.transform = `translateX(${from}px)`
  el.getBoundingClientRect()
  el.style.transition = 'transform 160ms ease'
  el.style.transform = ''
  el.addEventListener('transitionend', () => (el.style.transition = ''), { once: true })
}

interface Drag {
  item: DragItem
  /** The element that follows the pointer: a tab, a collapsed chip or an open group's box */
  key: string
  startX: number
  /** Pointer position in the row, and where on the dragged element it grabbed */
  x: number
  grab: number
  started: boolean
  /** The order shown while dragging */
  tabs: RepoSummary[]
  ws: Workspace[]
}

/**
 * Repository tabs on their own row, grouped like browser tab groups: each workspace is a
 * colored chip. Groups stay expanded until their chip is clicked to collapse them. Tabs that don't fit live in the ▾ menu; the active tab is always visible.
 * Tabs and groups drag like browser tabs: the dragged one follows the pointer and the others
 * slide out of its way. A tab dragged among a group's tabs joins it; dragged out, it leaves.
 */
export function TabBar({ tabs: propTabs, active, workspaces: propWs, collapsed, onSelect, onClose, onNew, onReorder, onOpenGroup, onCollapseGroup, onGroupMenu, onTabMenu, repoAi, groupAi }: Props) {
  const ui = useUi()
  const runs = useRuns()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  const [preview, setPreview] = useState<{ tabs: RepoSummary[]; ws: Workspace[] } | null>(null)
  const [lifted, setLifted] = useState<string | null>(null)
  const dragRef = useRef<Drag | null>(null)
  /** A drag just ended: the click that follows it must not select or collapse anything */
  const suppressClick = useRef(false)
  const lastSlots = useRef(new Map<string, number>())

  // Window listeners outlive renders: they reach the latest props through refs.
  const latest = useRef({ propTabs, propWs, onReorder })
  latest.current = { propTabs, propWs, onReorder }

  const tabs = preview?.tabs ?? propTabs
  const workspaces = preview?.ws ?? propWs

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

  // ------------------------------------------------------------ dragging

  const find = (key: string) => ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null

  /** Draws the dragged element under the pointer, kept inside the row; returns its center. */
  const place = (d: Drag): number | null => {
    const bar = ref.current
    const el = find(d.key)
    if (!bar || !el) return null
    const left = Math.max(0, Math.min(bar.clientWidth - el.offsetWidth, d.x - d.grab))
    el.style.transition = 'none'
    el.style.transform = `translateX(${left - slotLeft(el, bar)}px)`
    return left + el.offsetWidth / 2
  }

  /** Where the dragged element moves to now, given its center; null to stay put. */
  const targetFor = (d: Drag, center: number): DropTarget | null => {
    const bar = ref.current
    const self = find(d.key)
    if (!bar || !self) return null
    const selfLeft = slotLeft(self, bar)

    if (d.item.kind === 'tab') {
      const path = d.item.path
      const own = wsOf(d.ws, path)
      const ownBox = own ? find(`box:${own.id}`) : null
      const members = own ? d.tabs.filter((t) => wsOf([own], t.path)) : []
      // The last tab of a group dragged past the group's end leaves it, staying right after it.
      if (own && ownBox && members[members.length - 1]?.path === path && center > slotLeft(ownBox, bar) + ownBox.offsetWidth) {
        return { kind: 'group', id: own.id, before: false, open: false }
      }
      // A tab right after an open group, dragged into the group's box, joins it as its last tab.
      if (!own) {
        for (const b of bar.querySelectorAll<HTMLElement>(':scope > .tab-group-box')) {
          const right = slotLeft(b, bar) + b.offsetWidth
          if (right > selfLeft || selfLeft - right > 8 || center >= right) continue
          const w = d.ws.find((x) => `box:${x.id}` === b.dataset.key)
          const last = w && d.tabs.filter((t) => wsOf([w], t.path)).pop()
          if (last) return { kind: 'tab', path: last.path, before: false }
        }
      }
    }

    // Otherwise it swaps places with a neighbor once its center passes the neighbor's middle.
    const candidates =
      d.item.kind === 'tab' ? bar.querySelectorAll<HTMLElement>('.tab[data-key], .tab-group[data-key]') : bar.querySelectorAll<HTMLElement>(':scope > [data-key]')
    for (const c of candidates) {
      if (c === self || self.contains(c)) continue
      const l = slotLeft(c, bar)
      const r = l + c.offsetWidth
      if (center < l || center > r) continue
      const right = l >= selfLeft
      if (right ? center <= (l + r) / 2 : center >= (l + r) / 2) return null
      const key = c.dataset.key!
      if (key.startsWith('t:')) return { kind: 'tab', path: key.slice(2), before: !right }
      return { kind: 'group', id: key.slice(key.indexOf(':') + 1), before: !right, open: c.classList.contains('open') }
    }
    return null
  }

  const retarget = (d: Drag, center: number) => {
    const t = targetFor(d, center)
    const r = t && dropInBar(d.tabs, d.ws, d.item, t)
    if (!r) return
    const tab = d.item.kind === 'tab' ? d.item.path : null
    const joins = tab !== null && r.group !== undefined && wsOf(d.ws, tab)?.id !== (r.group ?? undefined)
    const ws = joins ? (r.group ? addRepos(d.ws, r.group, [tab]) : withoutRepos(d.ws, [tab])) : d.ws
    if (ws === d.ws && r.tabs.every((x, i) => x.path === d.tabs[i]?.path)) return
    d.tabs = r.tabs
    d.ws = ws
    setPreview({ tabs: r.tabs, ws })
  }

  const listeners = useRef<{ move(e: PointerEvent): void; up(): void; key(e: KeyboardEvent): void } | null>(null)

  const endDrag = (commit: boolean) => {
    const d = dragRef.current
    dragRef.current = null
    const l = listeners.current
    if (l) {
      window.removeEventListener('pointermove', l.move)
      window.removeEventListener('pointerup', l.up)
      window.removeEventListener('keydown', l.key, true)
    }
    listeners.current = null
    if (!d?.started) return
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    // The dragged element glides from the pointer into its slot.
    const el = find(d.key)
    if (el) slide(el, drawnOffset(el))
    setLifted(null)
    setPreview(null)
    const { propTabs: was, propWs: wasWs, onReorder: apply } = latest.current
    if (commit && (d.ws !== wasWs || d.tabs.some((t, i) => t.path !== was[i]?.path))) apply(d.tabs, d.ws)
  }

  const startDrag = (e: React.PointerEvent, item: DragItem, key: string) => {
    const bar = ref.current
    if (e.button !== 0 || dragRef.current || !bar) return
    const d: Drag = { item, key, startX: e.clientX, x: 0, grab: 0, started: false, tabs: propTabs, ws: propWs }
    dragRef.current = d
    const move = (ev: PointerEvent) => {
      if (dragRef.current !== d) return
      d.x = ev.clientX - bar.getBoundingClientRect().left
      if (!d.started) {
        if (Math.abs(ev.clientX - d.startX) < 5) return
        const el = find(d.key)
        if (!el) return endDrag(false)
        d.started = true
        d.grab = d.x - slotLeft(el, bar) - drawnOffset(el)
        setLifted(d.key)
        setPreview({ tabs: d.tabs, ws: d.ws })
      }
      const center = place(d)
      if (center !== null) retarget(d, center)
    }
    const up = () => endDrag(true)
    const key_ = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      endDrag(false)
    }
    listeners.current = { move, up, key: key_ }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key_, true)
  }

  useEffect(() => () => endDrag(false), [])

  // After the order changes mid drag, the other tabs slide from where they were drawn into their
  // new slots, and the dragged one stays under the pointer.
  useLayoutEffect(() => {
    const bar = ref.current
    if (!bar) return
    const d = dragRef.current
    const els = [...bar.querySelectorAll<HTMLElement>('[data-key]')]
    const next = new Map(els.map((el) => [el.dataset.key!, slotLeft(el, bar)]))
    if (d?.started) {
      const moved = new Map<HTMLElement, number>()
      for (const el of els) {
        const was = lastSlots.current.get(el.dataset.key!)
        if (was !== undefined) moved.set(el, was - next.get(el.dataset.key!)!)
      }
      for (const el of els) {
        if (el.dataset.key === d.key || !moved.has(el)) continue
        // Inside a box that moves too, only the part of the move the box doesn't make.
        const box = el.parentElement?.closest<HTMLElement>('[data-key]')
        const from = moved.get(el)! - (box ? (moved.get(box) ?? 0) : 0) + drawnOffset(el)
        if (Math.abs(from) > 0.5) slide(el, from)
      }
      place(d)
    }
    lastSlots.current = next
  }, [preview, lifted])

  // ------------------------------------------------------------ rendering

  const renderItem = (item: BarItem) =>
    item.kind === 'group' ? (
      <div
        key={`g:${item.ws.id}`}
        data-key={`g:${item.ws.id}`}
        className={`tab-group ${item.open ? 'open' : ''} ${lifted === `g:${item.ws.id}` ? 'lifted' : ''}`}
        onPointerDown={(e) => startDrag(e, { kind: 'group', id: item.ws.id }, item.open ? `box:${item.ws.id}` : `g:${item.ws.id}`)}
        style={{ '--group': `var(--lane-${item.ws.color})`, maxWidth: chipWidth(item.ws) } as React.CSSProperties}
        title={`${item.ws.name}: ${item.ws.repos.length} tab${item.ws.repos.length === 1 ? '' : 's'}\n${item.ws.folder}${item.open ? '\nClick to collapse' : '\nClick to open this workspace'}`}
        onClick={() => {
          if (suppressClick.current) return
          if (item.open) onCollapseGroup(item.ws)
          else onOpenGroup(item.ws)
        }}
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
        data-key={`t:${item.tab.path}`}
        className={`tab ${item.tab.path === active ? 'active' : ''} ${item.ws ? 'grouped' : ''} ${lifted === `t:${item.tab.path}` ? 'lifted' : ''}`}
        style={{ width: TAB_W, ...(item.ws ? ({ '--group': `var(--lane-${item.ws.color})` } as React.CSSProperties) : {}) }}
        title={item.tab.path}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('.tab-close')) return
          // Like a browser tab, it becomes active as soon as it is pressed.
          if (e.button === 0) onSelect(item.tab.path)
          startDrag(e, { kind: 'tab', path: item.tab.path }, `t:${item.tab.path}`)
        }}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault()
            onClose(item.tab.path)
          }
        }}
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
    <div className={`tabbar ${lifted ? 'dragging' : ''}`} ref={ref}>
      {segments.map((seg) =>
        seg.box ? (
          <div
            key={`box:${seg.box.id}`}
            data-key={`box:${seg.box.id}`}
            className={`tab-group-box ${lifted === `box:${seg.box.id}` ? 'lifted' : ''}`}
            style={{ '--group': `var(--lane-${seg.box.color})` } as React.CSSProperties}
          >
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
      <button
        className="tab-new"
        title="New or open a repository, or a new workspace"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onNew({ clientX: r.left, clientY: r.bottom + 2 })
        }}
      >
        +
      </button>
      <div className="tabbar-fill" />
    </div>
  )
}
