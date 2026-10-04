import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CommitDetail, FileDiff } from '@shared/types'
import { useApi } from '../api'
import { useRepo } from '../repoContext'
import { useUi } from '../ui'
import { DiffView } from './DiffView'
import { fileMenu } from '../menus'

/** How long the diffs of a small commit may hold back showing it, so it appears in one piece. */
const DIFF_WAIT_MS = 250
/** Dim the commit still on screen once the next one takes longer than this. */
const SLOW_MS = 150

export function CommitPanel({ sha: want }: { sha: string }) {
  const repo = useRepo()
  const api = useApi()
  const ui = useUi()
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [diffs, setDiffs] = useState<Record<string, FileDiff | null>>({})
  const [slow, setSlow] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // The commit on screen stays until the next one is ready, instead of blanking to "Loading…".
  // A small commit's diffs load with it (for a moment at most), so it doesn't jump as they arrive.
  useEffect(() => {
    let cancelled = false
    setError(null)
    const t = setTimeout(() => !cancelled && setSlow(true), SLOW_MS)
    api
      .commitDetail(want)
      .then(async (d) => {
        if (cancelled) return
        const auto = d.files.length <= 6 ? d.files.map((f) => f.path) : []
        const got: Record<string, FileDiff | null> = {}
        let shown = false
        const loads = auto.map((path) =>
          api.diff({ kind: 'commit', sha: want, path }).then(
            (x) => {
              got[path] = x
              // A diff that missed the wait fills in once the commit is on screen.
              if (shown && !cancelled) setDiffs((prev) => ({ ...prev, [path]: x }))
            },
            () => {}
          )
        )
        await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, DIFF_WAIT_MS))])
        if (cancelled) return
        setDetail(d)
        setExpanded(new Set(auto))
        setDiffs({ ...got })
        setSlow(false)
        shown = true
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setSlow(false)
      })
      .finally(() => clearTimeout(t))
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [want])

  // A new commit starts at the top.
  const shownSha = detail?.sha
  useLayoutEffect(() => {
    const scroller = root.current?.parentElement
    if (scroller) scroller.scrollTop = 0
  }, [shownSha])

  if (error) return <div className="empty">{error}</div>
  if (!detail) return slow ? <div className="empty">Loading…</div> : null
  const sha = detail.sha

  const toggle = (path: string) => {
    const n = new Set(expanded)
    if (n.has(path)) n.delete(path)
    else {
      n.add(path)
      if (!(path in diffs)) api.diff({ kind: 'commit', sha, path }).then((d) => setDiffs((prev) => ({ ...prev, [path]: d })))
    }
    setExpanded(n)
  }

  return (
    <div ref={root} key={sha} className={`detail fade-in ${slow ? 'stale' : ''}`}>
      <h2>{detail.subject}</h2>
      {detail.body.split('\n').slice(1).join('\n').trim() && (
        <pre className="body">{detail.body.split('\n').slice(1).join('\n').trim()}</pre>
      )}
      <div className="meta-grid">
        <span className="k">Commit</span>
        <span className="mono">
          {detail.sha}{' '}
          <span className="link" onClick={() => { navigator.clipboard.writeText(detail.sha); ui.toast('SHA copied') }}>copy</span>
        </span>
        <span className="k">Author</span>
        <span>
          {detail.author} <span className="dim">&lt;{detail.email}&gt;</span>
        </span>
        <span className="k">Date</span>
        <span>{new Date(detail.date).toLocaleString()}</span>
        {detail.committer !== detail.author && (
          <>
            <span className="k">Committer</span>
            <span>{detail.committer}</span>
          </>
        )}
        <span className="k">Parents</span>
        <span className="mono">
          {detail.parents.length === 0 && <span className="dim">none (root commit)</span>}
          {detail.parents.map((p) => (
            <span key={p} className="link" style={{ marginRight: 8 }} onClick={() => repo.select(p)}>
              {p.slice(0, 10)}
            </span>
          ))}
        </span>
      </div>

      <div className="section-head">
        <span className="grow">Files ({detail.files.length})</span>
        <button className="btn small" onClick={() => { setExpanded(new Set(detail.files.map((f) => f.path))); detail.files.forEach((f) => !(f.path in diffs) && api.diff({ kind: 'commit', sha, path: f.path }).then((d) => setDiffs((prev) => ({ ...prev, [f.path]: d })))) }}>
          Expand all
        </button>
        <button className="btn small" onClick={() => setExpanded(new Set())}>Collapse all</button>
      </div>
      {detail.files.map((f) => (
        <div key={f.path}>
          <div
            className="file-row"
            onClick={() => toggle(f.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              // The file as it is now in the working tree, not as this commit left it.
              ui.menu(e, fileMenu(repo.root, f.path, false, ui.toast))
            }}
          >
            <span className="chev">{expanded.has(f.path) ? '▾' : '▸'}</span>
            <span className={`st st-${f.status}`}>{f.status}</span>
            <span className="grow ellipsis">
              {f.oldPath ? <span className="dim">{f.oldPath} → </span> : null}
              {f.path}
            </span>
          </div>
          {expanded.has(f.path) && <DiffView diff={diffs[f.path]} loading={!(f.path in diffs)} mode="commit" />}
        </div>
      ))}
    </div>
  )
}
