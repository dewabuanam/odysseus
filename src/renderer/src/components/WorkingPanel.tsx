import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandResult, FileChange, FileDiff } from '@shared/types'
import { useApi, type DiffSource } from '../api'
import { stripAnsi } from '../ansi'
import { optimisticDiscard, optimisticResolve, optimisticStage, optimisticUnstage, useRepo } from '../repoContext'
import { norm, runStore, useActiveRun } from '../runs'
import { Ansi, fmtDuration, useTicker, useUi } from '../ui'
import { ConflictView } from './ConflictView'
import { DiffView } from './DiffView'
import { CALM_SCENES, OdysseyArt } from './OdysseyArt'
import type { CommitAction } from '../commands'
import { fileMenu, repoFile } from '../menus'

type Area = 'unstaged' | 'staged' | 'conflicted'

interface Failure {
  result: CommandResult
  output: string
  hook?: string
  amend: boolean
}

function draftKey(root: string) {
  return `odysseus.draft.${root}`
}

function loadDraft(root: string): string {
  try {
    return localStorage.getItem(draftKey(root)) ?? ''
  } catch {
    return ''
  }
}

function saveDraft(root: string, v: string) {
  try {
    if (v) localStorage.setItem(draftKey(root), v)
    else localStorage.removeItem(draftKey(root))
  } catch {
    /* storage unavailable */
  }
}

export function WorkingPanel() {
  const repo = useRepo()
  const ui = useUi()
  const api = useApi()
  const status = repo.status
  const [message, setMessage] = useState(() => loadDraft(repo.root))
  const [amend, setAmend] = useState(false)
  const [skipHooks, setSkipHooks] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [calmScene] = useState(() => CALM_SCENES[Math.floor(Math.random() * CALM_SCENES.length)])
  const [failure, setFailure] = useState<Failure | null>(null)
  const [modifiedByHook, setModifiedByHook] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [diffs, setDiffs] = useState<Record<string, FileDiff | null>>({})
  const preAmendMessage = useRef<string | null>(null)
  const activeRun = useActiveRun(repo.root)
  const now = useTicker(!!activeRun)

  useEffect(() => saveDraft(repo.root, message), [repo.root, message])

  const textRef = useRef<HTMLTextAreaElement>(null)
  const actionRef = useRef<(a: CommitAction) => void>(() => {})
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ root: string; action: CommitAction }>).detail
      if (norm(d.root) === norm(repo.root)) actionRef.current(d.action)
    }
    window.addEventListener('ody:commit', on)
    return () => window.removeEventListener('ody:commit', on)
  }, [repo.root])

  const keyOf = (area: Area, f: FileChange) => `${area}:${f.path}`

  const loadDiff = useCallback(async (area: Area, f: FileChange) => {
    const src: DiffSource =
      area === 'staged' ? { kind: 'staged', path: f.path } : { kind: 'unstaged', path: f.path, untracked: f.status === '?' }
    try {
      const d = await api.diff(src)
      setDiffs((prev) => ({ ...prev, [`${area}:${f.path}`]: d }))
    } catch (e) {
      setDiffs((prev) => ({ ...prev, [`${area}:${f.path}`]: null }))
      console.error(e)
    }
  }, [])

  // Reload expanded diffs whenever status changes (files edited, staged, hooks ran...)
  useEffect(() => {
    if (!status) return
    const lists: [Area, FileChange[]][] = [
      ['unstaged', status.unstaged],
      ['staged', status.staged],
      ['conflicted', status.conflicted]
    ]
    const stillThere = new Set<string>()
    for (const [area, files] of lists) {
      for (const f of files) {
        const k = keyOf(area, f)
        stillThere.add(k)
        if (expanded.has(k)) loadDiff(area, f)
      }
    }
    setExpanded((prev) => new Set([...prev].filter((k) => stillThere.has(k))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  if (!status) return <div className="empty">Loading…</div>

  const toggleExpand = (area: Area, f: FileChange) => {
    const k = keyOf(area, f)
    const n = new Set(expanded)
    if (n.has(k)) n.delete(k)
    else {
      n.add(k)
      loadDiff(area, f)
    }
    setExpanded(n)
  }

  const discard = async (files: FileChange[]) => {
    const r = await ui.ask({
      title: 'Discard changes?',
      message: files.length === 1 ? `Discard all changes to ${files[0].path}? This cannot be undone.` : `Discard changes to ${files.length} files? This cannot be undone.`,
      confirmLabel: 'Discard',
      danger: true
    })
    if (!r) return
    repo.mutate(() =>
      api.discard(
        files.filter((f) => f.status !== '?').map((f) => f.path),
        files.filter((f) => f.status === '?').map((f) => f.path)
      ),
      ['status'],
      optimisticDiscard(files.map((f) => f.path))
    )
  }

  const applyHunk = (area: Area, f: FileChange) => async (hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard') => {
    const d = diffs[keyOf(area, f)]
    if (!d) return
    if (f.status === '?' && action === 'stage') return repo.mutate(() => api.stage([f.path]))
    if (action === 'discard') {
      const r = await ui.ask({ title: 'Discard hunk?', message: 'The selected changes will be lost.', confirmLabel: 'Discard', danger: true })
      if (!r) return
    }
    repo.mutate(() => api.applyHunk(d, hunk, lines, action))
  }

  const toggleAmend = async (on: boolean) => {
    setAmend(on)
    if (on) {
      preAmendMessage.current = message
      if (!message.trim()) setMessage(await api.lastCommitMessage())
    } else if (preAmendMessage.current !== null) {
      setMessage(preAmendMessage.current)
      preAmendMessage.current = null
    }
  }

  const doCommit = async (noVerify = skipHooks, req?: { message: string; amend?: boolean; signoff?: boolean }) => {
    const msg = req?.message ?? message
    const isAmend = req?.amend ?? amend
    if (!msg.trim()) {
      ui.toast('Enter a commit message', true)
      return
    }
    const stagedBefore = new Set(status.staged.map((f) => f.path))
    setCommitting(true)
    setFailure(null)
    setModifiedByHook([])
    if (req) setMessage(req.message)
    const result = await repo.exec(() => api.commit({ message: msg, amend: isAmend, noVerify, signoff: req?.signoff }))
    setCommitting(false)

    if (result.ok) {
      setMessage('')
      setAmend(false)
      preAmendMessage.current = null
      ui.toast(isAmend ? 'Commit amended' : 'Committed')
    } else if (!result.cancelled) {
      const run = runStore.get().find((r) => norm(r.root) === norm(repo.root) && r.endedAt !== undefined)
      setFailure({ result, output: run?.output ?? result.stderr + result.stdout, hook: result.failedHook, amend: isAmend })
    }

    // Detect files modified by hooks (formatters / lint --fix) after they were staged.
    const after = await api.status().catch(() => null)
    if (after) {
      const touched = after.unstaged.filter((f) => stagedBefore.has(f.path) && f.status !== '?').map((f) => f.path)
      setModifiedByHook(touched)
    }

  }

  const commitAnyway = async () => {
    const r = await ui.ask({
      title: 'Commit without hooks?',
      message: (
        <>
          This runs <code>git commit --no-verify</code>, skipping <b>pre-commit</b> and <b>commit-msg</b>. Checks your team relies on
          will not run.
        </>
      ),
      confirmLabel: 'Commit with --no-verify',
      danger: true
    })
    if (r) doCommit(true)
  }

  actionRef.current = (a: CommitAction) => {
    if (typeof a === 'object') {
      if (a.amend !== undefined) setAmend(a.amend)
      doCommit(a.noVerify ?? false, a)
    } else if (a === 'focus') textRef.current?.focus()
    else if (a === 'commit') doCommit()
    else if (a === 'commit-no-verify') commitAnyway()
    else if (a === 'amend') {
      toggleAmend(!amend)
      textRef.current?.focus()
    }
  }

  const running = committing && activeRun
  const runningStep = activeRun?.steps.find((s) => s.state === 'running')
  const total = status.staged.length + status.unstaged.length + status.conflicted.length

  const fileList = (area: Area, files: FileChange[]) =>
    files.map((f) => {
      const k = keyOf(area, f)
      const open = expanded.has(k)
      return (
        <div key={k}>
          <div
            className="file-row"
            onClick={() => toggleExpand(area, f)}
            onContextMenu={(e) => {
              e.preventDefault()
              ui.menu(e, fileMenu(repo.root, f.path, f.status === 'D' || !!f.submodule, ui.toast))
            }}
          >
            <span className="chev">{open ? '▾' : '▸'}</span>
            <span className={`st st-${f.status}`}>{f.status === '?' ? 'N' : f.status}</span>
            <span className="grow ellipsis" title={f.path}>
              {f.oldPath ? <span className="dim">{f.oldPath} → </span> : null}
              {f.path}
              {f.submodule && (
                <span className="pill" style={{ marginLeft: 8 }} title="Submodule">
                  submodule{f.submoduleState ? ': ' + f.submoduleState : ''}
                </span>
              )}
            </span>
            <span className="actions" onClick={(e) => e.stopPropagation()}>
              {f.submodule && (
                <>
                  <button className="btn small" onClick={async () => repo.openRepo(await api.submodulePath(f.path))}>Open</button>
                  {area === 'unstaged' && (
                    <button className="btn small" title="Reset the submodule to the commit recorded in this repository" onClick={() => repo.exec(() => api.submoduleUpdate([f.path]), 'Submodule updated')}>
                      Update
                    </button>
                  )}
                </>
              )}
              {!f.submodule && f.status !== 'D' && (
                <button className="btn small ghost" title="Edit the file as it is on disk now, in its own window" onClick={() => api.openEditor(repoFile(repo.root, f.path))}>
                  Edit
                </button>
              )}
              {area === 'unstaged' && (
                <>
                  <button className="btn small" onClick={() => discard([f])}>Discard</button>
                  <button className="btn small" onClick={() => repo.mutate(() => api.stage([f.path]), ['status'], optimisticStage([f.path]))}>Stage</button>
                </>
              )}
              {area === 'staged' && <button className="btn small" onClick={() => repo.mutate(() => api.unstage([f.path]), ['status'], optimisticUnstage([f.path]))}>Unstage</button>}
              {area === 'conflicted' && (
                <>
                  <button className="btn small primary" onClick={() => repo.resolveConflicts(f.path)}>Resolve…</button>
                  <button className="btn small" onClick={() => repo.mutate(() => api.resolveConflict(f.path, 'ours'), ['status'], optimisticResolve(f.path))}>{status.operation === 'rebasing' ? 'Use upstream' : 'Use ours'}</button>
                  <button className="btn small" onClick={() => repo.mutate(() => api.resolveConflict(f.path, 'theirs'), ['status'], optimisticResolve(f.path))}>{status.operation === 'rebasing' ? 'Use mine' : 'Use theirs'}</button>
                  <button className="btn small" onClick={() => repo.mutate(() => api.stage([f.path]), ['status'], optimisticResolve(f.path))}>Mark resolved</button>
                </>
              )}
            </span>
          </div>
          {open && area === 'conflicted' && <ConflictView path={f.path} />}
          {open && area !== 'conflicted' && <DiffView diff={diffs[k]} loading={!(k in diffs)} mode={area === 'staged' ? 'staged' : 'unstaged'} onApply={applyHunk(area, f)} />}
        </div>
      )
    })

  return (
    <div className="detail">
      {status.operation && (
        <div className="op-banner">
          <span className="grow">
            Repository is <b>{status.operation}</b>
            {status.conflicted.length > 0 && `, ${status.conflicted.length} conflicted file(s)`}
          </span>
          {status.conflicted.length > 0 && <button className="btn small" onClick={() => repo.resolveConflicts()}>Resolve conflicts…</button>}
          <button className="btn small" onClick={() => repo.exec(() => api.abortOperation(status.operation!))}>Abort</button>
          <button className="btn small primary" disabled={status.conflicted.length > 0} onClick={() => repo.exec(() => api.continueOperation(status.operation!))}>
            Continue
          </button>
        </div>
      )}

      <div className="commit-box">
        <textarea
          ref={textRef}
          className="textarea"
          placeholder={'Commit message\n\nSummary on first line, details below.  (Ctrl+Enter to commit)'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doCommit()
          }}
        />
        <div className="opts">
          <label className="check">
            <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} /> Amend last commit
          </label>
          <label className={`check ${skipHooks ? 'skip-warn' : ''}`} title="git commit --no-verify">
            <input type="checkbox" checked={skipHooks} onChange={(e) => setSkipHooks(e.target.checked)} /> Skip hooks
          </label>
          <span className="grow" />
          <span className="faint">{message.split('\n')[0].length}/72</span>
          {running ? (
            <button className="btn danger" onClick={() => api.cancelRun(activeRun.id)}>Cancel</button>
          ) : (
            <button className="btn primary" disabled={committing || (!amend && status.staged.length === 0)} onClick={() => doCommit()}>
              {amend ? 'Amend' : `Commit${status.staged.length ? ` ${status.staged.length} file${status.staged.length > 1 ? 's' : ''}` : ''}`}
            </button>
          )}
        </div>

        {running && (
          <div className="hook-progress">
            <span className="spinner" />
            <span className="grow">
              {runningStep ? (
                <>
                  Running <b>{runningStep.hook}</b> hook… {fmtDuration(now - runningStep.startedAt)}
                </>
              ) : (
                'Committing…'
              )}
              {activeRun.steps
                .filter((s) => s.state !== 'running')
                .map((s) => (
                  <span key={s.childId} className="faint"> · {s.hook} {s.state === 'ok' ? '✓' : '✗'} {fmtDuration(s.durationMs)}</span>
                ))}
            </span>
            <button className="btn small ghost" onClick={repo.openConsole}>Show output</button>
          </div>
        )}

        {failure && !running && (
          <div className="hook-fail">
            <h4>
              {failure.hook ? `✗ ${failure.hook} hook failed` : '✗ Commit failed'}
              {failure.result.exitCode !== null && <span className="faint" style={{ fontWeight: 400 }}> (exit {failure.result.exitCode})</span>}
            </h4>
            <div className="dim" style={{ fontSize: 12 }}>
              {failure.hook
                ? 'Your commit message and staged changes are preserved. Fix the issues below and retry.'
                : 'Git reported an error. Your message is preserved.'}
            </div>
            <pre className="mono">
              <Ansi text={tailLines(failure.output, 40)} />
            </pre>
            <div className="row">
              <button className="btn small" onClick={repo.openConsole}>Open full output</button>
              <button className="btn small" onClick={() => navigator.clipboard.writeText(stripAnsi(failure.output))}>Copy output</button>
              <span className="grow" />
              {failure.hook && (
                <button className="btn small danger" onClick={commitAnyway}>Commit without hooks…</button>
              )}
              <button className="btn small primary" onClick={() => doCommit()}>Retry</button>
            </div>
          </div>
        )}

        {modifiedByHook.length > 0 && (
          <div className="notice">
            <b>Hooks modified {modifiedByHook.length} staged file{modifiedByHook.length > 1 ? 's' : ''}</b> (formatter / lint --fix?). These
            changes are <b>not</b> in the commit yet:
            <div className="mono" style={{ margin: '4px 0 6px' }}>{modifiedByHook.slice(0, 8).join(', ')}{modifiedByHook.length > 8 ? ' …' : ''}</div>
            <div className="row">
              <button className="btn small" onClick={() => setModifiedByHook([])}>Dismiss</button>
              <button
                className="btn small primary"
                onClick={async () => {
                  await repo.mutate(() => api.stage(modifiedByHook))
                  setModifiedByHook([])
                }}
              >
                Stage these changes
              </button>
            </div>
          </div>
        )}
      </div>

      {total === 0 && (
        <div className="empty">
          <OdysseyArt name={calmScene} className="empty-art" />
          Nothing to commit. Working tree clean.
        </div>
      )}

      {status.conflicted.length > 0 && (
        <>
          <div className="section-head" style={{ color: 'var(--red)' }}>Conflicts ({status.conflicted.length})</div>
          {fileList('conflicted', status.conflicted)}
        </>
      )}

      {status.unstaged.length > 0 && (
        <>
          <div className="section-head">
            <span className="grow">Unstaged ({status.unstaged.length})</span>
            <button className="btn small" onClick={() => discard(status.unstaged)}>Discard all</button>
            <button className="btn small" onClick={() => repo.mutate(() => api.stageAll(), ['status'], optimisticStage('all'))}>Stage all</button>
          </div>
          {fileList('unstaged', status.unstaged)}
        </>
      )}

      {status.staged.length > 0 && (
        <>
          <div className="section-head">
            <span className="grow">Staged ({status.staged.length})</span>
            <button className="btn small" onClick={() => repo.mutate(() => api.unstageAll(), ['status'], optimisticUnstage('all'))}>Unstage all</button>
          </div>
          {fileList('staged', status.staged)}
        </>
      )}
    </div>
  )
}

function tailLines(s: string, n: number): string {
  const lines = s.replace(/\n+$/, '').split('\n')
  return (lines.length > n ? '…\n' : '') + lines.slice(-n).join('\n')
}
