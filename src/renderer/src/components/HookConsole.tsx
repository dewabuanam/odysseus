import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { stripAnsi } from '../ansi'
import { runStore, useRuns, type RunState } from '../runs'
import { Ansi, fmtDuration, useTicker } from '../ui'

function runStatus(r: RunState): 'run' | 'ok' | 'fail' | 'off' {
  if (r.endedAt === undefined) return 'run'
  if (r.cancelled) return 'off'
  return r.exitCode === 0 ? 'ok' : 'fail'
}

export function HookConsole({ open, onToggle }: { open: boolean; onToggle(open: boolean): void }) {
  const runs = useRuns()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const outRef = useRef<HTMLPreElement>(null)
  const latest = runs[0]
  const active = runs.find((r) => r.endedAt === undefined)
  const now = useTicker(!!active)

  // Follow the newest run automatically.
  useEffect(() => {
    if (latest && follow) setSelectedId(latest.id)
  }, [latest?.id, follow])

  const run = runs.find((r) => r.id === selectedId) ?? latest

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run?.output, open])

  const failed = runs.filter((r) => runStatus(r) === 'fail').length

  return (
    <div className={`console ${open ? '' : 'collapsed'}`}>
      <div className="console-bar" onClick={() => onToggle(!open)}>
        <span className="faint">{open ? '▾' : '▸'}</span>
        <span className="title">Hook Console</span>
        {active ? (
          <span className="row" style={{ gap: 6, fontSize: 12 }}>
            <span className="spinner" /> {active.title}
            {active.steps.filter((s) => s.state === 'running').map((s) => (
              <span key={s.childId} className="pill gold">{s.hook} · {fmtDuration(now - s.startedAt)}</span>
            ))}
          </span>
        ) : latest ? (
          <span className="row" style={{ gap: 6, fontSize: 12 }}>
            <span className={`dot ${runStatus(latest)}`} />
            <span className="dim">{latest.title}</span>
            {latest.failedHook && <span style={{ color: 'var(--red)' }}>{latest.failedHook} hook failed</span>}
          </span>
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>No commands run yet</span>
        )}
        <span className="grow" />
        {failed > 0 && <span className="pill" style={{ color: 'var(--red)' }}>{failed} failed</span>}
        {active && (
          <button className="btn small danger" onClick={(e) => { e.stopPropagation(); api.cancelRun(active.id) }}>
            Cancel
          </button>
        )}
      </div>
      {open && (
        <div className="console-body">
          <div className="run-list">
            {runs.length === 0 && <div className="empty">Commits, pushes, checkouts and hook runs appear here with live output.</div>}
            {runs.map((r) => (
              <div
                key={r.id}
                className={`run-item ${run?.id === r.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(r.id)
                  setFollow(r.id === latest?.id)
                }}
              >
                <span className={`dot ${runStatus(r)}`} />
                <span className="grow ellipsis">{r.title}</span>
                <span className="faint">{fmtDuration((r.endedAt ?? now) - r.startedAt)}</span>
              </div>
            ))}
          </div>
          <div className="run-view">
            {run ? (
              <>
                <div className="steps">
                  <span className="mono faint ellipsis" style={{ maxWidth: 360 }} title={`git ${run.args.join(' ')}`}>
                    $ git {run.args.join(' ')}
                  </span>
                  {run.steps.length === 0 && run.endedAt !== undefined && <span className="faint" style={{ fontSize: 12 }}>no hooks ran</span>}
                  {run.steps.map((s) => (
                    <span key={s.childId} className={`step ${s.state}`}>
                      {s.state === 'running' ? <span className="spinner" /> : s.state === 'ok' ? '✓' : '✗'} {s.hook}
                      <span className="faint">
                        {s.state === 'running' ? fmtDuration(now - s.startedAt) : fmtDuration(s.durationMs)}
                        {s.state === 'fail' && s.exitCode !== undefined ? ` · exit ${s.exitCode}` : ''}
                      </span>
                    </span>
                  ))}
                  <span className="grow" />
                  {run.cancelled && <span className="pill">cancelled</span>}
                  {run.endedAt !== undefined && !run.cancelled && (
                    <span className="pill" style={{ color: run.exitCode === 0 ? 'var(--green)' : 'var(--red)' }}>exit {run.exitCode}</span>
                  )}
                  <button className="btn small ghost" onClick={() => navigator.clipboard.writeText(stripAnsi(run.output))}>Copy</button>
                  <button className="btn small ghost" onClick={() => runStore.clear()}>Clear</button>
                </div>
                <pre className="output" ref={outRef}>
                  {run.output ? <Ansi text={run.output} /> : <span className="faint">{run.endedAt ? '(no output)' : 'Waiting for output…'}</span>}
                </pre>
              </>
            ) : (
              <div className="empty">Select a run</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
