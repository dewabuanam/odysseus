import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Commit, GraphRow, WorkingStatus } from '@shared/types'
import { relTime } from '../ui'

const ROW_H = 26
const LANE_W = 14
const MAX_LANES = 14
// Colored-pencil lanes: the one splash of color in the paper theme (see --lane-* tokens).
const LANES = Array.from({ length: 8 }, (_, i) => ({ c: `var(--lane-${i})`, d: undefined as string | undefined }))

interface Props {
  commits: Commit[]
  graph: GraphRow[]
  status: WorkingStatus | null
  selected: string | null
  /** Only the active tab handles arrow keys */
  active?: boolean
  /** Commits found by a search; replaces the graph while set */
  results?: Commit[] | null
  onSelect(sha: string): void
  onContext(e: React.MouseEvent, c: Commit): void
  onRefContext?(e: React.MouseEvent, name: string): void
}

const EMPTY_ROW: GraphRow = { lane: 0, color: 0, top: [], bottom: [], width: 1 }

const x = (lane: number) => 10 + Math.min(lane, MAX_LANES) * LANE_W

function GraphCell({ row, width, isHead }: { row: GraphRow; width: number; isHead: boolean }) {
  const mid = ROW_H / 2
  const path = (x1: number, y1: number, x2: number, y2: number) =>
    x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
  return (
    <svg width={width} height={ROW_H} style={{ flexShrink: 0 }}>
      {row.top.map((e, i) => (
        <path key={`t${i}`} d={path(x(e.fromLane), 0, x(e.toLane), mid)} stroke={LANES[e.color].c} strokeDasharray={LANES[e.color].d} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.85} />
      ))}
      {row.bottom.map((e, i) => (
        <path key={`b${i}`} d={path(x(e.fromLane), mid, x(e.toLane), ROW_H)} stroke={LANES[e.color].c} strokeDasharray={LANES[e.color].d} strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.85} />
      ))}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={isHead ? 5 : 4}
        fill={isHead ? LANES[row.color].c : 'var(--paper)'}
        stroke={LANES[row.color].c}
        strokeWidth={2}
      />
    </svg>
  )
}

export function CommitList({ commits, graph, status, selected, active = true, results = null, onSelect, onContext, onRefContext }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const changes = status ? status.staged.length + status.unstaged.length + status.conflicted.length : 0
  const filtered = results !== null
  const showWip = !filtered && (changes > 0 || commits.length === 0)

  const rows = useMemo(
    () => (results ? results.map((c) => ({ c, g: EMPTY_ROW })) : commits.map((c, i) => ({ c, g: graph[i] }))),
    [commits, graph, results]
  )

  const graphWidth = useMemo(() => {
    const maxW = graph.reduce((m, r) => Math.max(m, r.width), 1)
    return 10 + Math.min(maxW, MAX_LANES + 1) * LANE_W
  }, [graph])

  const offset = showWip ? 1 : 0
  const total = rows.length + offset
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10)
  const last = Math.min(total, Math.ceil((scrollTop + height) / ROW_H) + 10)

  // Keyboard navigation
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, .palette, .modal')) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const ids = [...(showWip ? ['working'] : []), ...rows.map((r) => r.c.sha)]
      const idx = ids.indexOf(selected ?? '')
      const next = ids[Math.max(0, Math.min(ids.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        e.preventDefault()
        onSelect(next)
        const el = scrollRef.current
        const pos = ids.indexOf(next) * ROW_H
        if (el && (pos < el.scrollTop || pos > el.scrollTop + el.clientHeight - ROW_H)) el.scrollTop = pos - el.clientHeight / 2
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rows, selected, showWip, onSelect, active])

  const items: React.ReactNode[] = []
  for (let i = first; i < last; i++) {
    if (showWip && i === 0) {
      items.push(
        <div
          key="wip"
          className={`commit-row wip ${selected === 'working' ? 'selected' : ''}`}
          style={{ top: 0 }}
          onClick={() => onSelect('working')}
        >
          <svg width={graphWidth} height={ROW_H} style={{ flexShrink: 0 }}>
            {commits.length > 0 && !filtered && (
              <path d={`M${x(graph[0]?.lane ?? 0)} ${ROW_H / 2}L${x(graph[0]?.lane ?? 0)} ${ROW_H}`} stroke="var(--text-faint)" strokeWidth={2} strokeDasharray="3 3" />
            )}
            <circle cx={x(graph[0]?.lane ?? 0)} cy={ROW_H / 2} r={4.5} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeDasharray="2 2" />
          </svg>
          <span className="subject">
            {changes > 0 ? `Uncommitted changes (${changes})` : 'Working directory (no commits yet)'}
          </span>
        </div>
      )
      continue
    }
    const { c, g } = rows[i - offset]
    items.push(
      <Row
        key={c.sha}
        c={c}
        g={g}
        top={i * ROW_H}
        selected={selected === c.sha}
        filtered={filtered}
        graphWidth={graphWidth}
        onSelect={onSelect}
        onContext={onContext}
        onRefContext={onRefContext}
      />
    )
  }
  return renderList()

  function renderList() {
    return (
      <>
        {filtered && rows.length === 0 && <div className="empty">No commits match this search.</div>}
        <div className="commit-scroll" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <div style={{ height: total * ROW_H, position: 'relative' }}>{items}</div>
        </div>
      </>
    )
  }
}

interface RowProps {
  c: Commit
  g: GraphRow
  top: number
  selected: boolean
  filtered: boolean
  graphWidth: number
  onSelect(sha: string): void
  onContext(e: React.MouseEvent, c: Commit): void
  onRefContext?(e: React.MouseEvent, name: string): void
}

const Row = memo(function Row({ c, g, top, selected, filtered, graphWidth, onSelect, onContext, onRefContext }: RowProps) {
  const isHead = c.refs.some((r) => r.type === 'head')
  // Branch labels take the color of the graph line at this commit.
  const laneColor = filtered ? undefined : LANES[g.color].c
  return (
    <div
      className={`commit-row ${selected ? 'selected' : ''}`}
      style={{ top, ['--ref-lane' as string]: laneColor }}
      onClick={() => onSelect(c.sha)}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(c.sha)
        onContext(e, c)
      }}
    >
      {filtered ? <div style={{ width: 10 }} /> : <GraphCell row={g} width={graphWidth} isHead={isHead} />}
      <span className="subject">
        {c.refs
          .filter((r) => r.type !== 'head')
          .map((r) => (
            <span
              key={r.type + r.name}
              className={`ref ${r.type} ${isHead && r.type === 'branch' && c.refs.findIndex((x) => x.type === 'head') === c.refs.indexOf(r) - 1 ? 'head' : ''}`}
              onContextMenu={
                r.type === 'branch' || r.type === 'remote'
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onRefContext?.(e, r.name)
                    }
                  : undefined
              }
            >
              {r.name}
            </span>
          ))}
        {isHead && !c.refs.some((r) => r.type === 'branch') && <span className="ref headref">HEAD</span>}
        {c.subject}
      </span>
      <span className="author ellipsis">{c.author}</span>
      <span className="date" title={new Date(c.date).toLocaleString()}>
        {relTime(c.date)}
      </span>
    </div>
  )
})
