import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Branch,
  CommandResult,
  Commit,
  GraphRow,
  HookEvent,
  HooksOverview,
  OutputEvent,
  Remote,
  RepoSummary,
  RunEndEvent,
  RunStartEvent,
  Stash,
  Tag,
  WorkingStatus
} from '@shared/types'
import { api } from './api'
import { RepoContext, type RepoCtx } from './repoContext'
import { runStore, useActiveRun } from './runs'
import { UiProvider, useUi } from './ui'
import { CommitList } from './components/CommitList'
import { CommitPanel } from './components/CommitPanel'
import { HookConsole } from './components/HookConsole'
import { HooksView } from './components/HooksView'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { Welcome } from './components/Welcome'
import { WorkingPanel } from './components/WorkingPanel'
import logo from './assets/logo.png'

export function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  )
}

function Shell() {
  const ui = useUi()
  const [repo, setRepo] = useState<RepoSummary | null>(null)
  const [booting, setBooting] = useState(true)
  const [status, setStatus] = useState<WorkingStatus | null>(null)
  const [log, setLog] = useState<{ commits: Commit[]; graph: GraphRow[] }>({ commits: [], graph: [] })
  const [branches, setBranches] = useState<Branch[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [stashes, setStashes] = useState<Stash[]>([])
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [hooks, setHooks] = useState<HooksOverview | null>(null)
  const [selected, setSelected] = useState<string | null>('working')
  const [view, setView] = useState<'history' | 'hooks'>('history')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [listWidth, setListWidth] = useState(46)
  const activeRun = useActiveRun()
  const refreshing = useRef(false)
  const pending = useRef(false)

  // Forward main-process events to the run store.
  useEffect(() => {
    return window.ody.on((channel, payload) => {
      if (channel === 'runStart') runStore.onStart(payload as RunStartEvent)
      else if (channel === 'output') runStore.onOutput(payload as OutputEvent)
      else if (channel === 'hook') {
        runStore.onHook(payload as HookEvent)
      } else if (channel === 'runEnd') runStore.onEnd(payload as RunEndEvent)
      else if (channel === 'repoChanged' || channel === 'focus') refreshRef.current()
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!repo) return
    if (refreshing.current) {
      pending.current = true
      return
    }
    refreshing.current = true
    try {
      const [s, l, b, t, st, r, h] = await Promise.all([
        api.status(),
        api.log(),
        api.branches(),
        api.tags(),
        api.stashes(),
        api.remotes(),
        api.hooksOverview().catch(() => null)
      ])
      setStatus(s)
      setLog(l)
      setBranches(b)
      setTags(t)
      setStashes(st)
      setRemotes(r)
      setHooks(h)
    } catch (e) {
      console.error(e)
    } finally {
      refreshing.current = false
      if (pending.current) {
        pending.current = false
        refreshRef.current()
      }
    }
  }, [repo])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    refresh()
  }, [refresh])

  const openRepo = useCallback(
    async (dir: string) => {
      try {
        const r = await api.openRepo(dir)
        setStatus(null)
        setLog({ commits: [], graph: [] })
        setSelected('working')
        setView('history')
        setRepo(r)
      } catch (e) {
        ui.toast(`Not a git repository: ${(e as Error).message}`, true)
      }
    },
    [ui]
  )

  // Boot: theme + reopen last repository.
  useEffect(() => {
    ;(async () => {
      const s = await api.getSettings()
      document.documentElement.dataset.theme = s.theme
      const last = await api.lastRepo()
      if (last) await openRepo(last)
      setBooting(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-open the console when a hook starts running.
  useEffect(() => {
    if (activeRun?.steps.length) setConsoleOpen(true)
  }, [activeRun?.steps.length])

  const exec = useCallback(
    async (fn: () => Promise<CommandResult>, success?: string): Promise<CommandResult> => {
      let res: CommandResult
      try {
        res = await fn()
      } catch (e) {
        res = { ok: false, exitCode: null, cancelled: false, stdout: '', stderr: (e as Error).message }
      }
      if (res.ok) {
        if (success) ui.toast(success)
      } else if (res.cancelled) {
        ui.toast('Cancelled', true)
      } else {
        setConsoleOpen(true)
        const reason = res.failedHook ? `${res.failedHook} hook failed` : lastLine(res.stderr) || 'Command failed'
        ui.toast(reason, true)
      }
      await refreshRef.current()
      return res
    },
    [ui]
  )

  const mutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        return true
      } catch (e) {
        ui.toast((e as Error).message, true)
        return false
      } finally {
        await refreshRef.current()
      }
    },
    [ui]
  )

  const select = useCallback((sha: string) => {
    setView('history')
    setSelected(sha)
  }, [])

  const ctx: RepoCtx | null = useMemo(
    () =>
      repo && {
        root: repo.path,
        status,
        branches,
        tags,
        stashes,
        remotes,
        hooks,
        refresh,
        exec,
        mutate,
        openConsole: () => setConsoleOpen(true),
        select
      },
    [repo, status, branches, tags, stashes, remotes, hooks, refresh, exec, mutate, select]
  )

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'o') {
        e.preventDefault()
        api.pickRepo().then((d) => { if (d) openRepo(d) })
      } else if (mod && e.key === '`') {
        e.preventDefault()
        setConsoleOpen((o) => !o)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (e.key === 'F5' || (mod && e.key === 'r')) {
        e.preventDefault()
        refreshRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openRepo])

  if (booting) return <div className="app" />

  const commitMenu = (e: React.MouseEvent, c: Commit) => {
    ui.menu(e, [
      { label: 'Checkout (detached HEAD)', action: () => exec(() => api.checkout(c.sha)) },
      {
        label: 'Create branch here…',
        action: async () => {
          const r = await ui.ask({ title: 'Create branch', input: { label: 'Branch name' }, checkbox: { label: 'Check out after creating', checked: true }, confirmLabel: 'Create' })
          if (r) exec(() => api.createBranch(r.value, c.sha, r.checked))
        }
      },
      {
        label: 'Create tag here…',
        action: async () => {
          const r = await ui.ask({ title: 'Create tag', input: { label: 'Tag name' }, confirmLabel: 'Create' })
          if (r) exec(() => api.createTag(r.value, c.sha))
        }
      },
      { separator: true, label: '' },
      { label: 'Cherry-pick', action: () => exec(() => api.cherryPick(c.sha)) },
      { label: 'Revert commit', action: () => exec(() => api.revert(c.sha)) },
      { separator: true, label: '' },
      { label: 'Reset to here (soft)', action: () => exec(() => api.reset(c.sha, 'soft')) },
      { label: 'Reset to here (mixed)', action: () => exec(() => api.reset(c.sha, 'mixed')) },
      {
        label: 'Reset to here (hard)…',
        danger: true,
        action: async () => {
          const r = await ui.ask({ title: 'Hard reset?', message: `Reset to ${c.sha.slice(0, 8)} and discard ALL uncommitted changes?`, confirmLabel: 'Hard reset', danger: true })
          if (r) exec(() => api.reset(c.sha, 'hard'))
        }
      },
      { separator: true, label: '' },
      { label: 'Copy SHA', action: () => navigator.clipboard.writeText(c.sha) },
      { label: 'Copy message', action: () => navigator.clipboard.writeText(c.subject) }
    ])
  }

  const push = async () => {
    const cur = branches.find((b) => b.current)
    if (!cur) return ui.toast('Not on a branch', true)
    if (!cur.upstream) {
      const r = await ui.ask({
        title: `Push ${cur.name}`,
        message: `${cur.name} has no upstream. Push to ${remotes[0]?.name ?? 'origin'} and set upstream?`,
        confirmLabel: 'Push'
      })
      if (!r) return
      return exec(() => api.push({ remote: remotes[0]?.name ?? 'origin', branch: cur.name, setUpstream: true }), 'Pushed')
    }
    exec(() => api.push({}), 'Pushed')
  }

  const current = branches.find((b) => b.current)

  return (
    <div className="app">
      <div className="toolbar">
        <img src={logo} className="logo" alt="" />
        {repo ? (
          <>
            <span
              className="repo-name"
              title={repo.path}
              onClick={async (e) => {
                const recent = await api.recentRepos()
                ui.menu(e, [
                  ...recent.filter((r) => r.path !== repo.path).map((r) => ({ label: r.name, action: () => openRepo(r.path) })),
                  { separator: true, label: '' },
                  { label: 'Open repository…', action: () => api.pickRepo().then((d) => { if (d) openRepo(d) }) },
                  { label: 'Show in file manager', action: () => api.openExternal(repo.path) },
                  { label: 'Close repository', action: () => setRepo(null) }
                ])
              }}
            >
              {repo.name} ▾
            </span>
            <span className="branch-pill" title={current?.upstream ? `tracking ${current.upstream}` : ''}>
              ⎇ {status?.detached ? 'detached HEAD' : status?.branch ?? '…'}
              {status && (status.ahead > 0 || status.behind > 0) && (
                <span className="mono dim">
                  {status.ahead ? `↑${status.ahead}` : ''} {status.behind ? `↓${status.behind}` : ''}
                </span>
              )}
            </span>
            <span className="sep" />
            <div className="tabs">
              <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>History</button>
              <button className={view === 'hooks' ? 'active' : ''} onClick={() => setView('hooks')}>
                Hooks{hooks?.missingCommands.length ? ' ⚠' : ''}
              </button>
            </div>
            <span className="grow" />
            <button className="btn" disabled={!!activeRun} onClick={() => exec(() => api.fetch(), 'Fetched')}>Fetch</button>
            <button className="btn" disabled={!!activeRun} onClick={() => exec(() => api.pull(), 'Pulled')}>
              Pull {status?.behind ? <span className="badge">{status.behind}</span> : null}
            </button>
            <button className="btn" disabled={!!activeRun} onClick={push}>
              Push {status?.ahead ? <span className="badge">{status.ahead}</span> : null}
            </button>
            <button
              className="btn"
              disabled={!!activeRun}
              onClick={async () => {
                const r = await ui.ask({ title: 'Stash changes', input: { label: 'Message (optional)', value: 'WIP' }, confirmLabel: 'Stash' })
                if (r) exec(() => api.stash(r.value), 'Stashed')
              }}
            >
              Stash
            </button>
            <button
              className="btn"
              onClick={async () => {
                const r = await ui.ask({ title: 'New branch', input: { label: 'Branch name' }, confirmLabel: 'Create & checkout' })
                if (r) exec(() => api.createBranch(r.value))
              }}
            >
              Branch
            </button>
          </>
        ) : (
          <span className="grow" />
        )}
        <button className="btn ghost" title="Settings (Ctrl+,)" onClick={() => setSettingsOpen(true)}>⚙</button>
      </div>

      {!repo || !ctx ? (
        <Welcome onOpen={openRepo} />
      ) : (
        <RepoContext.Provider value={ctx}>
          <div className="main">
            <Sidebar
              selected={selected}
              view={view}
              onSelectWorking={() => select('working')}
              onShowHooks={() => setView('hooks')}
            />
            <div className="center">
              {view === 'hooks' ? (
                <HooksView onOpenSettings={() => setSettingsOpen(true)} />
              ) : (
                <div className="split">
                  <div className="pane-list" style={{ width: `${listWidth}%` }}>
                    <CommitList
                      commits={log.commits}
                      graph={log.graph}
                      status={status}
                      selected={selected}
                      onSelect={setSelected}
                      onContext={commitMenu}
                    />
                  </div>
                  <div
                    className="resizer"
                    onMouseDown={(e) => {
                      const parent = e.currentTarget.parentElement!.getBoundingClientRect()
                      const move = (ev: MouseEvent) => setListWidth(Math.min(75, Math.max(25, ((ev.clientX - parent.left) / parent.width) * 100)))
                      const up = () => {
                        window.removeEventListener('mousemove', move)
                        window.removeEventListener('mouseup', up)
                      }
                      window.addEventListener('mousemove', move)
                      window.addEventListener('mouseup', up)
                    }}
                  />
                  <div className="pane-detail">
                    {selected === 'working' || !selected ? <WorkingPanel key={repo.path} /> : <CommitPanel sha={selected} />}
                  </div>
                </div>
              )}
              <HookConsole open={consoleOpen} onToggle={setConsoleOpen} />
            </div>
          </div>
        </RepoContext.Provider>
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            document.documentElement.dataset.theme = s.theme
            ui.toast('Settings saved')
            refreshRef.current()
          }}
        />
      )}
    </div>
  )
}

function lastLine(s: string): string {
  const lines = s.trim().split('\n').filter((l) => l.trim() && !/^(hint|remote):/.test(l))
  return lines[lines.length - 1]?.slice(0, 200) ?? ''
}
