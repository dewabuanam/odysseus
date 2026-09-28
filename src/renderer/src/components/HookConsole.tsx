import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { stripAnsi } from '../ansi'
import { useRepo } from '../repoContext'
import { runStore, useRuns, type RunState } from '../runs'
import { Ansi, fmtDuration, relTime, useTicker } from '../ui'

function runStatus(r: RunState): 'run' | 'ok' | 'fail' | 'off' | 'queued' {
  if (r.startedAt === undefined && r.endedAt === undefined) return 'queued'
  if (r.endedAt === undefined) return 'run'
  if (r.cancelled) return 'off'
  return r.exitCode === 0 ? 'ok' : 'fail'
}

/**
 * Per-repository console: the command queue (running + waiting), live hook output, and the
 * persisted command history of this repository.
 */
export function HookConsole({ open, onToggle }: { open: boolean; onToggle(open: boolean): void }) {
  const repo = useRepo()
  const runs = useRuns(repo.root)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [follow, setFollow] = useState(true)
  const outRef = useRef<HTMLPreElement>(null)
  const active = runs.find((r) => r.startedAt !== undefined && r.endedAt === undefined)
  const queued = runs.filter((r) => runStatus(r) === 'queued').reverse()
  const finished = runs.filter((r) => r.endedAt !== undefined)
  const latest = active ?? finished[0]
  const now = useTicker(!!active)

  // Follow the running command automatically.
  useEffect(() => {
    if (latest && follow) setSelectedId(latest.id)
  }, [latest?.id, follow])

  // "Command history" in the palette jumps to a specific run.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (runs.some((r) => r.id === id)) {
        setSelectedId(id)
        setFollow(false)
      }
    }
    window.addEventListener('ody:console-select', on)
    return () => window.removeEventListener('ody:console-select', on)
  }, [runs])

  const run = runs.find((r) => r.id === selectedId) ?? latest

  useEffect(() => {
    const el = outRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run?.output, open])

  const failed = finished.filter((r) => !r.fromHistory && runStatus(r) === 'fail').length

  const item = (r: RunState, label?: string) => (
    <div
      key={r.id}
      className={`run-item ${run?.id === r.id ? 'active' : ''} ${r.fromHistory ? 'old' : ''}`}
      onClick={() => {
        setSelectedId(r.id)
        setFollow(r.id === latest?.id)
      }}
    >
      <span className={`dot ${runStatus(r)}`} />
      <span className="grow ellipsis">{r.title}</span>
      {label ? (
        <span className="faint">{label}</span>
      ) : (
        <span className="faint">{r.startedAt ? fmtDuration((r.endedAt ?? now) - r.startedAt) : ''}</span>
      )}
      {runStatus(r) === 'queued' && (
        <button
          className="btn small ghost"
          title="Remove from queue"
          onClick={(e) => {
            e.stopPropagation()
            api.cancelRun(r.id)
          }}
        >
          ×
        </button>
      )}
    </div>
  )

  return (
    <div className={`console ${open ? '' : 'collapsed'}`}>
      <div className="console-bar" onClick={() => onToggle(!open)}>
        <span className="faint">{open ? '▾' : '▸'}</span>
        <span className="title">Console</span>
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
            {latest.failedHook && <span className="fail-text">{latest.failedHook} hook failed</span>}
          </span>
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>No commands run yet</span>
        )}
        {queued.length > 0 && <span className="pill">{queued.length} queued</span>}
        <span className="grow" />
        {failed > 0 && <span className="pill fail-text">{failed} failed</span>}
        {active && (
          <button className="btn small danger" onClick={(e) => { e.stopPropagation(); api.cancelRun(active.id) }}>
            Cancel
          </button>
        )}
      </div>
      {open && (
        <div className="console-body">
          <div className="run-list">
            {runs.length === 0 && <div className="empty">Every git command runs here, in order. Hooks stream live.</div>}
            {queued.length > 0 && <div className="run-group">Queue</div>}
            {queued.map((r, i) => item(r, `#${i + 1}`))}
            {active && <div className="run-group">Running</div>}
            {active && item(active)}
            {finished.length > 0 && <div className="run-group">History</div>}
            {finished.map((r) => item(r))}
          </div>
          <div className="run-view">
            {run ? (
              <>
                <div className="steps">
                  <span className="mono faint ellipsis" style={{ maxWidth: 360 }} title={`git ${run.args.join(' ')}`}>
                    $ git {run.args.join(' ')}
                  </span>
                  {runStatus(run) === 'queued' && <span className="pill">waiting in queue</span>}
                  {run.fromHistory && <span className="faint" style={{ fontSize: 12 }}>{relTime(run.queuedAt)}</span>}
                  {run.steps.length === 0 && run.endedAt !== undefined && !run.fromHistory && <span className="faint" style={{ fontSize: 12 }}>no hooks ran</span>}
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
                    <span className={`pill ${run.exitCode === 0 ? '' : 'fail-text'}`}>exit {run.exitCode}</span>
                  )}
                  <button className="btn small ghost" onClick={() => navigator.clipboard.writeText(stripAnsi(run.output))}>Copy</button>
                  <button className="btn small ghost" onClick={() => runStore.clear(repo.root)}>Clear</button>
                </div>
                <pre className="output" ref={outRef}>
                  {run.output ? <Ansi text={run.output} /> : <span className="faint">{run.endedAt ? '(no output)' : run.startedAt ? 'Waiting for output…' : 'Queued. Starts when the commands before it finish.'}</span>}
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
