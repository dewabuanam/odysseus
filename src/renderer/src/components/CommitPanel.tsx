import { useEffect, useState } from 'react'
import type { CommitDetail, FileDiff } from '@shared/types'
import { api } from '../api'
import { useRepo } from '../repoContext'
import { useUi } from '../ui'
import { DiffView } from './DiffView'

export function CommitPanel({ sha }: { sha: string }) {
  const repo = useRepo()
  const ui = useUi()
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [diffs, setDiffs] = useState<Record<string, FileDiff | null>>({})

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setError(null)
    setDiffs({})
    api
      .commitDetail(sha)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        // Auto-expand small commits.
        const auto = d.files.length <= 6 ? d.files.map((f) => f.path) : []
        setExpanded(new Set(auto))
        auto.forEach((p) => load(p))
      })
      .catch((e) => !cancelled && setError(e.message))
    const load = (path: string) =>
      api.diff({ kind: 'commit', sha, path }).then((d) => !cancelled && setDiffs((prev) => ({ ...prev, [path]: d })))
    return () => {
      cancelled = true
    }
  }, [sha])

  if (error) return <div className="empty">{error}</div>
  if (!detail) return <div className="empty">Loading…</div>

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
    <div className="detail">
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
          <div className="file-row" onClick={() => toggle(f.path)}>
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
