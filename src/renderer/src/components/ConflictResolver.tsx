import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../api'
import { useRepo } from '../repoContext'
import { mergeResult, parseConflicts, type ConflictChoice as Choice, type ConflictPart } from '@shared/conflicts'

// ------------------------------------------------------------------ view

/**
 * Conflict resolution window: every conflicted file, each conflict block side by side, a
 * choice per block, and the merged result. Opens by itself when an operation stops on conflicts.
 */
export function ConflictResolver({ initial, onClose }: { initial?: string; onClose(): void }) {
  const api = useApi()
  const repo = useRepo()
  const status = repo.status
  const files = status?.conflicted.map((f) => f.path) ?? []
  const [path, setPath] = useState<string | null>(initial ?? files[0] ?? null)
  const op = status?.operation ?? null

  // A resolved file drops out of the list; move on to the next one.
  useEffect(() => {
    if (!path || !files.includes(path)) setPath(files[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.join('\0')])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const [ours, theirs] = op === 'rebasing' ? ['Upstream', 'Your commit'] : ['Current', 'Incoming']

  return (
    <div className="overlay resolver-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal resolver">
        <div className="resolver-head">
          <h3 className="grow">Resolve conflicts</h3>
          {op && <span className="dim">Repository is {op}</span>}
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
        {files.length === 0 ? (
          <div className="resolver-done">
            <div>No conflicts left.</div>
            {op && (
              <button
                className="btn primary"
                onClick={() => {
                  onClose()
                  repo.exec(() => api.continueOperation(op))
                }}
              >
                Continue {op}
              </button>
            )}
          </div>
        ) : (
          <div className="resolver-body">
            <div className="resolver-files">
              {files.map((f) => (
                <div key={f} className={`resolver-file ${f === path ? 'active' : ''}`} title={f} onClick={() => setPath(f)}>
                  <span className="ellipsis">{f.split('/').pop()}</span>
                  <span className="faint ellipsis">{f.split('/').slice(0, -1).join('/')}</span>
                </div>
              ))}
            </div>
            {path && <FileResolver key={path} path={path} oursName={ours} theirsName={theirs} />}
          </div>
        )}
      </div>
    </div>
  )
}

function FileResolver({ path, oursName, theirsName }: { path: string; oursName: string; theirsName: string }) {
  const api = useApi()
  const repo = useRepo()
  const [content, setContent] = useState<string | null>(null)
  const [sides, setSides] = useState<{ ours: boolean; theirs: boolean } | null>(null)
  const [choices, setChoices] = useState<Choice[]>([])
  const [manual, setManual] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.conflictContent(path).then(setContent)
    api.conflictSides(path).then(setSides, () => setSides({ ours: true, theirs: true }))
  }, [api, path])

  const parts = useMemo(() => (content === null ? [] : parseConflicts(content)), [content])
  const blocks = parts.filter((p): p is ConflictPart => p.kind === 'conflict')
  useEffect(() => setChoices(blocks.map(() => 'none')), [blocks.length])

  if (content === null || !sides) return <div className="resolver-main"><div className="faint">Loading…</div></div>

  const whole = (side: 'ours' | 'theirs') => repo.mutate(() => api.resolveConflict(path, side), ['status'])
  const save = async (text: string) => {
    setSaving(true)
    await repo.mutate(() => api.saveResolution(path, text), ['status'])
    setSaving(false)
  }

  const head = (
    <div className="resolver-toolbar">
      <span className="mono grow ellipsis" title={path}>{path}</span>
      <button className="btn small" onClick={() => whole('ours')}>{sides.ours ? `Take ${oursName.toLowerCase()} file` : `Delete (${oursName.toLowerCase()} deleted it)`}</button>
      <button className="btn small" onClick={() => whole('theirs')}>{sides.theirs ? `Take ${theirsName.toLowerCase()} file` : `Delete (${theirsName.toLowerCase()} deleted it)`}</button>
    </div>
  )

  // Binary files and delete/modify conflicts have no markers to pick between.
  if (!blocks.length) {
    return (
      <div className="resolver-main">
        {head}
        <div className="resolver-note">
          {!sides.ours || !sides.theirs
            ? `This file was deleted on one side and changed on the other. Keep a version or delete it.`
            : 'No conflict markers in this file (it may be binary, or already edited). Take one side, or mark the file resolved as it is.'}
        </div>
        <div className="buttons">
          {sides.ours && sides.theirs && <button className="btn primary" onClick={() => repo.mutate(() => api.stage([path]), ['status'])}>Mark resolved as is</button>}
        </div>
      </div>
    )
  }

  const unresolved = choices.filter((c) => c === 'none').length
  const setChoice = (i: number, c: Choice) => setChoices((cs) => cs.map((x, j) => (j === i ? (x === c ? 'none' : c) : x)))
  const all = (c: Choice) => setChoices(blocks.map(() => c))
  let bi = 0

  return (
    <div className="resolver-main">
      {head}
      {manual === null ? (
        <>
          <div className="resolver-bulk">
            <span className="grow dim">
              {blocks.length} conflict{blocks.length === 1 ? '' : 's'}
              {unresolved ? `, ${unresolved} left to choose` : ', all chosen'}
            </span>
            <button className="btn small" onClick={() => all('ours')}>All {oursName.toLowerCase()}</button>
            <button className="btn small" onClick={() => all('theirs')}>All {theirsName.toLowerCase()}</button>
          </div>
          <div className="resolver-parts">
            {parts.map((p, pi) => {
              if (p.kind === 'text') return <Context key={pi} lines={p.lines} first={pi === 0} last={pi === parts.length - 1} />
              const i = bi++
              const c = choices[i] ?? 'none'
              return (
                <div key={pi} className={`resolver-block ${c !== 'none' ? 'chosen' : ''}`}>
                  <div className="resolver-sides">
                    <Side title={oursName} sub={p.oursLabel} lines={p.ours} on={c === 'ours' || c.startsWith('ours-') || c.endsWith('-ours')} onClick={() => setChoice(i, 'ours')} />
                    <Side title={theirsName} sub={p.theirsLabel} lines={p.theirs} on={c === 'theirs' || c.startsWith('theirs-') || c.endsWith('-theirs')} onClick={() => setChoice(i, 'theirs')} />
                  </div>
                  <div className="resolver-choices">
                    <span className="faint grow">Conflict {i + 1}{p.base ? `, base had ${p.base.length} line${p.base.length === 1 ? '' : 's'}` : ''}</span>
                    {(['ours', 'theirs', 'ours-theirs', 'theirs-ours'] as Choice[]).map((k) => (
                      <button key={k} className={`btn small ${c === k ? 'primary' : ''}`} onClick={() => setChoice(i, k)}>
                        {k === 'ours' ? `Use ${oursName.toLowerCase()}` : k === 'theirs' ? `Use ${theirsName.toLowerCase()}` : `Both, ${(k === 'ours-theirs' ? oursName : theirsName).toLowerCase()} first`}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="buttons">
            <button className="btn" onClick={() => setManual(mergeResult(parts, choices))}>Edit result by hand</button>
            <button className="btn primary" disabled={unresolved > 0 || saving} onClick={() => save(mergeResult(parts, choices))}>
              Save and mark resolved
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="resolver-bulk">
            <span className="grow dim">
              Edit the merged file. {/^(<<<<<<<|>>>>>>>)/m.test(manual) ? 'Conflict markers are still in it.' : 'No conflict markers left.'}
            </span>
          </div>
          <textarea className="textarea mono resolver-edit" spellCheck={false} value={manual} onChange={(e) => setManual(e.target.value)} />
          <div className="buttons">
            <button className="btn" onClick={() => setManual(null)}>Back to choices</button>
            <button className="btn primary" disabled={saving} onClick={() => save(manual)}>Save and mark resolved</button>
          </div>
        </>
      )}
    </div>
  )
}

function Side({ title, sub, lines, on, onClick }: { title: string; sub: string; lines: string[]; on: boolean; onClick(): void }) {
  return (
    <div className={`resolver-side ${on ? 'on' : ''}`} onClick={onClick} title="Click to use this side">
      <div className="resolver-side-head">
        <b>{title}</b>
        {sub && <span className="faint ellipsis">{sub}</span>}
      </div>
      <pre className="mono">{lines.length ? lines.map((l) => l.replace(/\r$/, '')).join('\n') : <span className="faint">(nothing)</span>}</pre>
    </div>
  )
}

/** Unchanged text between conflicts, trimmed to a few lines around each block. */
function Context({ lines, first, last }: { lines: string[]; first: boolean; last: boolean }) {
  const [open, setOpen] = useState(false)
  const n = 3
  const clean = lines.map((l) => l.replace(/\r$/, ''))
  if (open || clean.length <= n * 2 + 1) return <pre className="mono resolver-context">{clean.join('\n')}</pre>
  const head = first ? [] : clean.slice(0, n)
  const tail = last ? [] : clean.slice(-n)
  const hidden = clean.length - head.length - tail.length
  return (
    <div className="resolver-context">
      {head.length > 0 && <pre className="mono">{head.join('\n')}</pre>}
      <div className="resolver-fold" onClick={() => setOpen(true)}>⋯ {hidden} unchanged line{hidden === 1 ? '' : 's'}</div>
      {tail.length > 0 && <pre className="mono">{tail.join('\n')}</pre>}
    </div>
  )
}
