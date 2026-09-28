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
  Submodule,
  Tag,
  WorkingStatus
} from '@shared/types'
import { api } from './api'
import { branchPicker, buildCommands, newBranchFlowFor, recentPicker, tagFlowFor, type CommandDeps, type CommitAction } from './commands'
import { matchesKeys, Palette, type Step } from './palette'
import { RepoContext, type RepoCtx, type RefreshScope } from './repoContext'
import { runStore } from './runs'
import { UiProvider, useUi } from './ui'
import { CommitList } from './components/CommitList'
import { CommitPanel } from './components/CommitPanel'
import { HookConsole } from './components/HookConsole'
import { HooksView } from './components/HooksView'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Welcome } from './components/Welcome'
import { WorkingPanel } from './components/WorkingPanel'

export function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  )
}

const ALL: RefreshScope[] = ['status', 'refs', 'hooks']

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
  const [submodules, setSubmodules] = useState<Submodule[]>([])
  const [superproject, setSuperproject] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>('working')
  const [view, setView] = useState<'history' | 'hooks'>('history')
  const [hookSel, setHookSel] = useState<string>('pre-commit')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [palette, setPalette] = useState<Step | null>(null)
  const [listWidth, setListWidth] = useState(46)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const logKey = useRef<string | undefined>(undefined)
  const refreshing = useRef(false)
  const queued = useRef(new Set<RefreshScope>())

  // ------------------------------------------------------------ refresh (scoped)

  const refresh = useCallback(
    async (scopes: RefreshScope[] = ALL) => {
      if (!repo) return
      scopes.forEach((s) => queued.current.add(s))
      if (refreshing.current) return
      refreshing.current = true
      try {
        while (queued.current.size) {
          const want = new Set(queued.current)
          queued.current.clear()
          const jobs: Promise<unknown>[] = []
          // Ref changes can change status (checkout) so they always imply a status refresh.
          if (want.has('status') || want.has('refs')) jobs.push(api.status().then(setStatus), api.submodules().then(setSubmodules, () => setSubmodules([])))
          if (want.has('refs')) {
            jobs.push(
              api.log(undefined, logKey.current).then((l) => {
                logKey.current = l.key
                if (!l.unchanged) setLog({ commits: l.commits, graph: l.graph })
              }),
              api.branches().then(setBranches),
              api.tags().then(setTags),
              api.stashes().then(setStashes),
              api.remotes().then(setRemotes)
            )
          }
          if (want.has('hooks')) jobs.push(api.hooksOverview().then(setHooks, () => setHooks(null)))
          await Promise.all(jobs).catch((e) => console.error(e))
        }
      } finally {
        refreshing.current = false
      }
    },
    [repo]
  )
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    logKey.current = undefined
    refresh(ALL)
  }, [refresh])

  // Forward main-process events.
  useEffect(() => {
    return window.ody.on((channel, payload) => {
      if (channel === 'runStart') runStore.onStart(payload as RunStartEvent)
      else if (channel === 'output') runStore.onOutput(payload as OutputEvent)
      else if (channel === 'hook') runStore.onHook(payload as HookEvent)
      else if (channel === 'runEnd') runStore.onEnd(payload as RunEndEvent)
      else if (channel === 'repoChanged') refreshRef.current((payload as { scopes: RefreshScope[] }).scopes)
      else if (channel === 'focus') refreshRef.current(['status', 'refs'])
    })
  }, [])

  // Auto-open the console as soon as a hook starts.
  useEffect(
    () =>
      runStore.subscribe(() => {
        const active = runStore.get().find((r) => r.endedAt === undefined)
        if (active?.steps.length) setConsoleOpen(true)
      }),
    []
  )

  // ------------------------------------------------------------ actions

  const openRepo = useCallback(
    async (dir: string) => {
      try {
        const r = await api.openRepo(dir)
        setStatus(null)
        setLog({ commits: [], graph: [] })
        setHooks(null)
        setSubmodules([])
        api.superproject().then(setSuperproject, () => setSuperproject(null))
        setSelected('working')
        setView('history')
        setRepo(r)
      } catch (e) {
        ui.toast(`Not a git repository: ${(e as Error).message}`, true)
      }
    },
    [ui]
  )

  useEffect(() => {
    ;(async () => {
      const s = await api.getSettings()
      setTheme(s.theme)
      document.documentElement.dataset.theme = s.theme
      const last = await api.lastRepo()
      if (last) await openRepo(last)
      setBooting(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        ui.toast(res.failedHook ? `${res.failedHook} hook failed` : lastLine(res.stderr) || 'Command failed', true)
      }
      // Don't make the caller wait for the UI refresh; results (and hook failures) show at once.
      void refreshRef.current(['status', 'refs'])
      return res
    },
    [ui]
  )

  const mutate = useCallback(
    async (fn: () => Promise<unknown>, scopes: RefreshScope[] = ['status']) => {
      try {
        await fn()
        return true
      } catch (e) {
        ui.toast((e as Error).message, true)
        return false
      } finally {
        await refreshRef.current(scopes)
      }
    },
    [ui]
  )

  const select = useCallback((sha: string) => {
    setView('history')
    setSelected(sha)
  }, [])

  const commitAction = useCallback((a: CommitAction) => {
    setView('history')
    setSelected('working')
    // Let WorkingPanel mount before it receives the action.
    setTimeout(() => window.dispatchEvent(new CustomEvent('ody:commit', { detail: a })), 30)
  }, [])

  const toggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    await api.setSettings({ theme: next })
  }, [theme])

  // ------------------------------------------------------------ commands

  const deps: CommandDeps = {
    repo,
    status,
    branches,
    tags,
    stashes,
    remotes,
    commits: log.commits,
    hooks,
    submodules,
    superproject,
    exec,
    mutate: (fn) => mutate(fn, ['status', 'hooks']),
    ask: ui.ask,
    toast: ui.toast,
    openRepo,
    closeRepo: () => setRepo(null),
    select,
    showHooks: (h) => {
      if (h) setHookSel(h)
      setView('hooks')
    },
    commitAction,
    toggleConsole: () => setConsoleOpen((o) => !o),
    toggleSidebar: () => setSidebarOpen((o) => !o),
    toggleTheme,
    openSettings: () => setSettingsOpen(true),
    refresh: () => refreshRef.current(ALL)
  }
  const commands = buildCommands(deps)
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  const depsRef = useRef(deps)
  depsRef.current = deps

  const openPalette = useCallback((step?: Step) => {
    setPalette(step ?? { kind: 'list', placeholder: 'Type a command…', items: commandsRef.current })
  }, [])

  // Global shortcuts come from the same command table the palette shows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (palette || settingsOpen) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && (e.key.toLowerCase() === 'p' || e.code === 'KeyP')) {
        e.preventDefault()
        openPalette()
        return
      }
      const inText = (e.target as HTMLElement).closest('input, textarea, select')
      for (const c of commandsRef.current) {
        if (!c.keys || c.when === false) continue
        // Let the commit box handle Mod+Enter itself.
        if (inText && c.keys === 'Mod+Enter') continue
        if (inText && !c.keys.includes('Mod') && !c.keys.startsWith('F')) continue
        if (matchesKeys(e, c.keys)) {
          e.preventDefault()
          const r = c.run()
          Promise.resolve(r).then((step) => step && openPalette(step))
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette, settingsOpen, openPalette])

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
        submodules,
        superproject,
        openRepo,
        refresh,
        exec,
        mutate,
        openConsole: () => setConsoleOpen(true),
        select
      },
    [repo, status, branches, tags, stashes, remotes, hooks, submodules, superproject, openRepo, refresh, exec, mutate, select]
  )

  if (booting) return <div className="app" />

  const commitMenu = (e: React.MouseEvent, c: Commit) => {
    ui.menu(e, [
      { label: 'Checkout (detached HEAD)', action: () => exec(() => api.checkout(c.sha)) },
      {
        label: 'Create branch here…',
        action: () => openPalette(newBranchFlowFor(depsRef.current, c.sha))
      },
      {
        label: 'Create tag here…',
        action: () => openPalette(tagFlowFor(depsRef.current, c.sha))
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

  return (
    <div className="app">
      <TitleBar
        repo={repo}
        status={status}
        parent={superproject}
        onParent={() => superproject && openRepo(superproject)}
        onPalette={() => openPalette()}
        onRepoMenu={() => recentPicker(depsRef.current).then(openPalette)}
        onBranchMenu={() =>
          openPalette(
            branchPicker(depsRef.current, 'Checkout branch', (b) => { exec(() => (b.remote ? api.checkoutRemote(b.name) : api.checkout(b.name))) }, { excludeCurrent: true })
          )
        }
      />

      {!repo || !ctx ? (
        <Welcome onOpen={openRepo} />
      ) : (
        <RepoContext.Provider value={ctx}>
          <div className="main">
            {sidebarOpen && (
              <Sidebar selected={selected} view={view} onSelectWorking={() => select('working')} onShowHooks={() => setView('hooks')} />
            )}
            <div className="center">
              {view === 'hooks' ? (
                <HooksView selected={hookSel} onSelect={setHookSel} onOpenSettings={() => setSettingsOpen(true)} />
              ) : (
                <div className="split">
                  <div className="pane-list" style={{ width: `${listWidth}%` }}>
                    <CommitList commits={log.commits} graph={log.graph} status={status} selected={selected} onSelect={setSelected} onContext={commitMenu} />
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

      {palette && <Palette initial={palette} onClose={() => setPalette(null)} />}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(s) => {
            setTheme(s.theme)
            document.documentElement.dataset.theme = s.theme
            ui.toast('Settings saved')
            refreshRef.current(ALL)
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
