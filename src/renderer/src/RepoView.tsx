import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Branch,
  CommandResult,
  Commit,
  GraphRow,
  HooksOverview,
  Remote,
  RepoSummary,
  Stash,
  Submodule,
  Tag,
  WorkingStatus
} from '@shared/types'
import { ApiContext, repoApi } from './api'
import { buildCommands, identityFlow, list, type CommandDeps, type CommitAction } from './commands'
import { isEmptyQuery, parseSearch } from '@shared/search'
import { SearchBar } from './components/SearchBar'
import { branchMenu, commitMenu, type MenuDeps } from './menus'
import type { Cmd, Step } from './palette'
import { RepoContext, type RepoCtx, type RefreshScope } from './repoContext'
import { norm, runStore } from './runs'
import { fmtDuration, relTime, useUi } from './ui'
import { CommitList } from './components/CommitList'
import { CommitPanel } from './components/CommitPanel'
import { HookConsole } from './components/HookConsole'
import { HooksView } from './components/HooksView'
import { Sidebar } from './components/Sidebar'
import { WorkingPanel } from './components/WorkingPanel'
import { ConflictResolver } from './components/ConflictResolver'

const ALL: RefreshScope[] = ['status', 'refs', 'hooks']

/** What App needs from each tab: its commands and a way to push file-system changes in. */
export interface TabHandle {
  commands(): Cmd[]
  refresh(scopes: RefreshScope[]): void
}

export interface TabInfo {
  status: WorkingStatus | null
  superproject: string | null
}

interface Props {
  tab: RepoSummary
  active: boolean
  openRepo(dir: string): void
  closeTab(path: string): void
  openPalette(step: Step): void
  openSettings(): void
  toggleTheme(): void
  register(root: string, handle: TabHandle | null): void
  onInfo(root: string, info: TabInfo): void
}

/**
 * Memoized: the app re-renders often (AI status, other tabs), and an unchanged repository view
 * (every open tab has one) skips that.
 */
export const RepoView = memo(function RepoView({ tab, active, openRepo, closeTab, openPalette, openSettings, toggleTheme, register, onInfo }: Props) {
  const ui = useUi()
  const api = useMemo(() => repoApi(tab.path), [tab.path])
  const [status, setStatus] = useState<WorkingStatus | null>(null)
  const [log, setLog] = useState<{ commits: Commit[]; graph: GraphRow[] }>({ commits: [], graph: [] })
  const [branches, setBranches] = useState<Branch[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [stashes, setStashes] = useState<Stash[]>([])
  const [remotes, setRemotes] = useState<Remote[]>([])
  const [hooks, setHooks] = useState<HooksOverview | null>(null)
  const [submodules, setSubmodules] = useState<Submodule[]>([])
  const [superproject, setSuperproject] = useState<string | null>(null)
  const [hidden, setHiddenState] = useState<string[]>([])
  const [onlyRef, setOnlyRef] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>('working')
  const [view, setView] = useState<'history' | 'hooks'>('history')
  const [hookSel, setHookSel] = useState<string>('pre-commit')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [resolver, setResolver] = useState<{ path?: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [listWidth, setListWidth] = useState(46)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Commit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)
  const logKey = useRef<string | undefined>(undefined)
  const refreshing = useRef(false)
  const queued = useRef(new Set<RefreshScope>())
  const stale = useRef(new Set<RefreshScope>())
  const filterRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const viewOpts = useRef({ hidden, only: onlyRef })
  viewOpts.current = { hidden, only: onlyRef }

  // ------------------------------------------------------------ refresh (scoped, coalesced)

  const refresh = useCallback(
    async (scopes: RefreshScope[] = ALL) => {
      // Background tabs don't hit git; they catch up when you switch to them.
      if (!activeRef.current) {
        scopes.forEach((s) => stale.current.add(s))
        return
      }
      scopes.forEach((s) => queued.current.add(s))
      if (refreshing.current) return
      refreshing.current = true
      try {
        while (queued.current.size) {
          const want = new Set(queued.current)
          queued.current.clear()
          const jobs: Promise<unknown>[] = []
          if (want.has('status') || want.has('refs')) {
            jobs.push(api.status().then(setStatus), api.submodules().then(setSubmodules, () => setSubmodules([])))
          }
          if (want.has('refs')) {
            const opts = { hidden: viewOpts.current.hidden, only: viewOpts.current.only ?? undefined }
            jobs.push(
              api.log(undefined, logKey.current, opts).then((l) => {
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
    [api]
  )
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // First load, and catching up when a background tab becomes active.
  useEffect(() => {
    if (!active) return
    if (!status) {
      refresh(ALL)
      api.superproject().then(setSuperproject, () => setSuperproject(null))
      api.getHidden().then(setHiddenState)
      api.history(tab.path, 150).then((h) => runStore.loadHistory(tab.path, h))
    } else {
      refresh(['status', 'refs', ...stale.current])
      stale.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Search runs on git (whole history), debounced; stale responses are dropped.
  useEffect(() => {
    const parsed = parseSearch(query)
    if (isEmptyQuery(parsed)) {
      setResults(null)
      setSearching(false)
      return
    }
    const seq = ++searchSeq.current
    setSearching(true)
    const t = setTimeout(() => {
      api
        .search(parsed)
        .then((r) => seq === searchSeq.current && setResults(r))
        .catch(() => seq === searchSeq.current && setResults([]))
        .finally(() => seq === searchSeq.current && setSearching(false))
    }, 220)
    return () => clearTimeout(t)
  }, [query, api, log.commits])

  const people = useMemo(() => {
    const seen = new Map<string, number>()
    for (const c of log.commits.slice(0, 2000)) seen.set(c.author, (seen.get(c.author) ?? 0) + 1)
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 40)
  }, [log.commits])
  const refNames = useMemo(() => [...branches.map((b) => b.name), ...tags.map((t) => t.name)], [branches, tags])
  const pathNames = useMemo(
    () => (status ? [...new Set([...status.unstaged, ...status.staged, ...status.conflicted].flatMap((f) => [f.path, f.path.split('/').slice(0, -1).join('/')]).filter(Boolean))] : []),
    [status]
  )

  // Re-query the graph when view options change.
  useEffect(() => {
    logKey.current = undefined
    refreshRef.current(['refs'])
  }, [hidden, onlyRef])

  useEffect(() => onInfo(tab.path, { status, superproject }), [status, superproject, tab.path, onInfo])

  // Open the resolver as soon as a merge, rebase, pull or stash stops on conflicts.
  const conflictCount = status?.conflicted.length ?? 0
  const prevConflicts = useRef<number | null>(null)
  useEffect(() => {
    if (status === null) return
    if (prevConflicts.current !== null && prevConflicts.current === 0 && conflictCount > 0 && activeRef.current) setResolver({})
    prevConflicts.current = conflictCount
  }, [conflictCount, status])

  const resolveConflicts = useCallback((path?: string) => setResolver({ path }), [])

  // Auto-open the console as soon as a hook starts in this repository.
  useEffect(
    () =>
      runStore.subscribe(() => {
        const running = runStore.get().find((r) => norm(r.root) === norm(tab.path) && r.startedAt !== undefined && r.endedAt === undefined)
        if (running?.steps.length) setConsoleOpen(true)
      }),
    [tab.path]
  )

  // ------------------------------------------------------------ actions

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
      } else if (/would be overwritten by (merge|checkout)|Please commit your changes or stash them/.test(res.stderr + res.stdout)) {
        // Blocked by local changes: offer to stash them, retry, and put them back.
        ui.toast('Local changes are in the way', true)
        openPalette({
          kind: 'list',
          placeholder: 'Your local changes block this command',
          title: 'Local changes',
          items: [
            {
              id: 'stash-retry',
              title: 'Stash my changes, retry, then restore them',
              cmdline: 'git stash -u && <retry> && git stash pop',
              run: async () => {
                const st = await api.stash({ message: 'odysseus: auto-stash before retry', includeUntracked: true })
                if (!st.ok) return void ui.toast('Could not stash your changes', true)
                const again = await execRef.current(fn, success)
                if (again.ok) await execRef.current(() => api.stashApply('stash@{0}', true), 'Your changes are back')
                else ui.toast('Retry failed; your changes are safe in stash@{0}', true)
              }
            },
            { id: 'console', title: 'Show the error in the console', cmdline: '', run: () => setConsoleOpen(true) }
          ]
        })
      } else if (/Please tell me who you are|unable to auto-detect email/.test(res.stderr + res.stdout)) {
        // Fresh machine: git has no author identity. Ask for it right away instead of just failing.
        ui.toast('Git needs your name and email before it can commit', true)
        openPalette(identityFlow(depsRef.current, 'Git needs your name for commits'))
      } else {
        setConsoleOpen(true)
        ui.toast(res.failedHook ? `${res.failedHook} hook failed` : lastLine(res.stderr) || 'Command failed', true)
      }
      // Results (and hook failures) show at once; the UI refresh follows in the background.
      void refreshRef.current(['status', 'refs'])
      return res
    },
    [ui, openPalette, api]
  )
  const execRef = useRef(exec)
  execRef.current = exec

  const mutate = useCallback(
    async (fn: () => Promise<unknown>, scopes: RefreshScope[] = ['status'], optimistic?: (s: WorkingStatus) => WorkingStatus) => {
      // Apply the expected result immediately so the click feels instant; git confirms after.
      if (optimistic) setStatus((s) => (s ? optimistic(s) : s))
      try {
        await fn()
        return true
      } catch (e) {
        ui.toast((e as Error).message, true)
        return false
      } finally {
        void refreshRef.current(scopes)
      }
    },
    [ui]
  )

  const select = useCallback((sha: string) => {
    setView('history')
    setSelected(sha)
  }, [])

  const placeRef = useRef({ view, selected })
  placeRef.current = { view, selected }
  const commitAction = useCallback(
    (a: CommitAction) => {
      const fire = () => window.dispatchEvent(new CustomEvent('ody:commit', { detail: { root: tab.path, action: a } }))
      // Commit box already on screen: act now, so keystrokes typed right after land in it.
      if (placeRef.current.view === 'history' && placeRef.current.selected === 'working') {
        fire()
        return
      }
      setView('history')
      setSelected('working')
      setTimeout(fire, 30) // let WorkingPanel mount first
    },
    [tab.path]
  )

  const setHidden = useCallback(
    (refs: string[]) => {
      setHiddenState(refs)
      api.setHidden(refs)
    },
    [api]
  )

  const searchRef = useCallback((ref: string | null) => {
    setOnlyRef(ref)
    setView('history')
  }, [])

  const showHistory = useCallback(() => {
    const entries = runStore.get().filter((r) => norm(r.root) === norm(tab.path))
    openPalette(
      list(
        'Command history',
        entries.map((r) => ({
          id: r.id,
          title: r.title,
          detail: `${r.endedAt === undefined ? (r.startedAt === undefined ? 'queued' : 'running') : r.cancelled ? 'cancelled' : r.exitCode === 0 ? 'ok' : `failed${r.failedHook ? ` (${r.failedHook})` : ''}`} · ${relTime(r.queuedAt)}${r.endedAt && r.startedAt ? ` · ${fmtDuration(r.endedAt - r.startedAt)}` : ''}`,
          cmdline: `git ${r.args.join(' ')}`,
          run: () => {
            setConsoleOpen(true)
            window.dispatchEvent(new CustomEvent('ody:console-select', { detail: r.id }))
          }
        })),
        'History'
      )
    )
  }, [openPalette, tab.path])

  // ------------------------------------------------------------ commands & menus

  const headSha = log.commits.find((c) => c.refs.some((r) => r.type === 'head'))?.sha ?? null

  const deps: MenuDeps = {
    api,
    repo: tab,
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
    closeRepo: () => closeTab(tab.path),
    select,
    showHooks: (h) => {
      if (h) setHookSel(h)
      setView('hooks')
    },
    commitAction,
    toggleConsole: () => setConsoleOpen((o) => !o),
    toggleSidebar: () => setSidebarOpen((o) => !o),
    resolveConflicts,
    toggleTheme,
    openSettings,
    refresh: () => refreshRef.current(ALL),
    find: () => {
      setView('history')
      setTimeout(() => {
        filterRef.current?.focus()
        filterRef.current?.select()
      }, 0)
    },
    showHistory,
    openPalette,
    hidden,
    setHidden,
    searchRef,
    headSha
  }
  const depsRef = useRef(deps)
  depsRef.current = deps

  // Stable callbacks so memoized commit rows don't re-render on every state change.
  const onCommitContext = useCallback((e: React.MouseEvent, c: Commit) => ui.menu(e, commitMenu(depsRef.current, c)), [ui])
  const onRefContext = useCallback(
    (e: React.MouseEvent, name: string) => {
      const b = depsRef.current.branches.find((x) => x.name === name)
      if (b) ui.menu(e, branchMenu(depsRef.current, b))
    },
    [ui]
  )

  useEffect(() => {
    register(tab.path, {
      commands: () => buildCommands(depsRef.current as CommandDeps),
      refresh: (scopes) => refreshRef.current(scopes)
    })
    return () => register(tab.path, null)
  }, [register, tab.path])

  const laneColors = useMemo(() => {
    const m = new Map<string, number>()
    log.commits.forEach((c, i) => {
      const g = log.graph[i]
      if (g) m.set(c.sha, g.color)
    })
    return m
  }, [log])

  const ctx: RepoCtx = useMemo(
    () => ({
      root: tab.path,
      status,
      branches,
      tags,
      stashes,
      remotes,
      hooks,
      submodules,
      superproject,
      hidden,
      laneColors,
      openRepo,
      refresh,
      exec,
      mutate,
      openConsole: () => setConsoleOpen(true),
      select,
      branchMenu: (e, b) => ui.menu(e, branchMenu(depsRef.current, b)),
      openPalette,
      resolveConflicts
    }),
    [tab.path, status, branches, tags, stashes, remotes, hooks, submodules, superproject, hidden, laneColors, openRepo, refresh, exec, mutate, select, ui, openPalette, resolveConflicts]
  )

  return (
    <ApiContext.Provider value={api}>
      <RepoContext.Provider value={ctx}>
        <div className="main" style={active ? undefined : { display: 'none' }}>
          {sidebarOpen && <Sidebar selected={selected} view={view} onSelectWorking={() => select('working')} onShowHooks={() => setView('hooks')} />}
          <div className="center">
            {view === 'hooks' ? (
              <HooksView selected={hookSel} onSelect={setHookSel} onOpenSettings={openSettings} />
            ) : (
              <div className="split">
                <div className="pane-list" style={{ width: `${listWidth}%` }}>
                  {onlyRef && (
                    <div className="scope-banner">
                      <span className="grow ellipsis">
                        Showing only <b>{onlyRef}</b>
                      </span>
                      <button className="btn small" onClick={() => setOnlyRef(null)}>Show all</button>
                    </div>
                  )}
                  <SearchBar
                    value={query}
                    onChange={setQuery}
                    inputRef={filterRef}
                    refs={refNames}
                    people={people}
                    paths={pathNames}
                    resultCount={results ? results.length : null}
                    busy={searching}
                  />
                  <CommitList
                    results={results}
                    commits={log.commits}
                    graph={log.graph}
                    status={status}
                    selected={selected}
                    active={active}
                    onSelect={setSelected}
                    onContext={onCommitContext}
                    onRefContext={onRefContext}
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
                  {selected === 'working' || !selected ? <WorkingPanel /> : <CommitPanel sha={selected} />}
                </div>
              </div>
            )}
            <HookConsole open={consoleOpen} onToggle={setConsoleOpen} />
          </div>
        </div>
        {resolver && active && <ConflictResolver initial={resolver.path} onClose={() => setResolver(null)} />}
      </RepoContext.Provider>
    </ApiContext.Provider>
  )
})

function lastLine(s: string): string {
  const lines = s.trim().split('\n').filter((l) => l.trim() && !/^(hint|remote):/.test(l))
  return lines[lines.length - 1]?.slice(0, 200) ?? ''
}
