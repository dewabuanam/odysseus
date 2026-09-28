import { useEffect, useMemo, useRef, useState } from 'react'
import type { Commit, GraphRow, WorkingStatus } from '@shared/types'
import { relTime } from '../ui'

const ROW_H = 26
const LANE_W = 14
const MAX_LANES = 14
// Monochrome lanes: told apart by pencil pressure (shade) and dash pattern instead of color.
const LANES = [
  { c: 'var(--ink)', d: undefined },
  { c: 'var(--ink-2)', d: '5 3' },
  { c: 'var(--ink)', d: '1.5 3' },
  { c: 'var(--ink-3)', d: undefined },
  { c: 'var(--ink-2)', d: '8 3 2 3' },
  { c: 'var(--ink)', d: '4 4' },
  { c: 'var(--ink-3)', d: '6 2' },
  { c: 'var(--ink-2)', d: undefined }
]

interface Props {
  commits: Commit[]
  graph: GraphRow[]
  status: WorkingStatus | null
  selected: string | null
  onSelect(sha: string): void
  onContext(e: React.MouseEvent, c: Commit): void
}

const x = (lane: number) => 10 + Math.min(lane, MAX_LANES) * LANE_W

function GraphCell({ row, width, isHead }: { row: GraphRow; width: number; isHead: boolean }) {
  const mid = ROW_H / 2
  const path = (x1: number, y1: number, x2: number, y2: number) =>
    x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
  return (
    <svg width={width} height={ROW_H} style={{ flexShrink: 0 }}>
      {row.top.map((e, i) => (
        <path key={`t${i}`} d={path(x(e.fromLane), 0, x(e.toLane), mid)} stroke={LANES[e.color].c} strokeDasharray={LANES[e.color].d} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      ))}
      {row.bottom.map((e, i) => (
        <path key={`b${i}`} d={path(x(e.fromLane), mid, x(e.toLane), ROW_H)} stroke={LANES[e.color].c} strokeDasharray={LANES[e.color].d} strokeWidth={1.6} strokeLinecap="round" fill="none" />
      ))}
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={isHead ? 5 : 4}
        fill={isHead ? 'var(--ink)' : 'var(--paper)'}
        stroke="var(--ink)"
        strokeWidth={1.6}
      />
    </svg>
  )
}

export function CommitList({ commits, graph, status, selected, onSelect, onContext }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const changes = status ? status.staged.length + status.unstaged.length + status.conflicted.length : 0
  const showWip = changes > 0 || commits.length === 0

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const all = commits.map((c, i) => ({ c, g: graph[i] }))
    if (!f) return all
    return all.filter(
      ({ c }) => c.subject.toLowerCase().includes(f) || c.author.toLowerCase().includes(f) || c.sha.startsWith(f)
    )
  }, [commits, graph, filter])
  const filtered = filter.trim() !== ''

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
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
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
  }, [rows, selected, showWip, onSelect])

  const items = []
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
    const isHead = c.refs.some((r) => r.type === 'head')
    items.push(
      <div
        key={c.sha}
        className={`commit-row ${selected === c.sha ? 'selected' : ''}`}
        style={{ top: i * ROW_H }}
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
  }

  return (
    <>
      <div className="list-header">
        <input className="input" placeholder="Filter commits (message, author, sha)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {rows.length} commits
        </span>
      </div>
      <div className="commit-scroll" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        <div style={{ height: total * ROW_H, position: 'relative' }}>{items}</div>
      </div>
    </>
  )
}
