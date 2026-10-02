import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HookEvent,
  Keymap,
  OutputEvent,
  RepoSummary,
  RunEndEvent,
  RunQueuedEvent,
  RunStartEvent,
  Settings,
  Workspace
} from '@shared/types'
import { aggregateAi, type AiState } from '@shared/types'
import { api } from './api'
import { ranked } from './commands'
import { bindingsFor, KEYMAP_NAMES } from './keymaps'
import { formatKeys, matchesKeys, Palette, type Cmd, type Step } from './palette'
import type { RefreshScope } from './repoContext'
import { RepoView, type TabHandle, type TabInfo } from './RepoView'
import { norm, runStore } from './runs'
import { UiProvider, useUi } from './ui'
import { SettingsDialog } from './components/SettingsDialog'
import { TabBar } from './components/TabBar'
import { TitleBar } from './components/TitleBar'
import { Welcome } from './components/Welcome'
import { defaultProfile, TerminalPane, type TerminalHandle, type TermScope } from './components/TerminalPane'
import { addRepos, commonFolder, newId, nextColor, prune, withoutRepos, wsOf, LANE_COUNT } from './workspaces'

const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Teal', 'Brown', 'Pink']

export function App() {
  return (
    <UiProvider>
      <Shell />
    </UiProvider>
  )
}

function Shell() {
  const ui = useUi()
  const [booting, setBooting] = useState(true)
  const [tabs, setTabs] = useState<RepoSummary[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [info, setInfo] = useState<Record<string, TabInfo>>({})
  const [palette, setPalette] = useState<Step | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [keymap, setKeymap] = useState<Keymap>('default')
  const [workspaces, setWorkspacesState] = useState<Workspace[]>([])
  const [appSettings, setAppSettings] = useState<Settings | null>(null)
  const [termOpen, setTermOpen] = useState(false)
  const [termUsed, setTermUsed] = useState(false)
  const [aiStates, setAiStates] = useState<Record<string, AiState>>({})
  const termRef = useRef<TerminalHandle>(null)
  const handles = useRef(new Map<string, TabHandle>())
  const stateRef = useRef({ tabs, active, workspaces })
  stateRef.current = { tabs, active, workspaces }

  // ------------------------------------------------------------ tabs

  const persist = (t: RepoSummary[], a: string | null) => api.setTabs(t.map((x) => x.path), a)
  const saveWorkspaces = useCallback((ws: Workspace[]) => {
    stateRef.current.workspaces = ws
    setWorkspacesState(ws)
    api.setWorkspaces(ws)
  }, [])

  /** Opens several repositories as tabs at once (a workspace folder); returns the ones that opened. */
  const openRepos = useCallback(async (dirs: string[]): Promise<RepoSummary[]> => {
    const opened: RepoSummary[] = []
    for (const d of dirs) {
      try {
        opened.push(await api.openRepo(d))
      } catch {
        /* not a repository */
      }
    }
    if (!opened.length) return opened
    const { tabs: cur } = stateRef.current
    const add = opened.filter((r) => !cur.some((t) => norm(t.path) === norm(r.path)))
    const next = [...cur, ...add]
    const act = cur.find((t) => norm(t.path) === norm(opened[0].path))?.path ?? opened[0].path
    setTabs(next)
    setActive(act)
    persist(next, act)
    return opened.map((r) => next.find((t) => norm(t.path) === norm(r.path)) ?? r)
  }, [])

  const openRepo = useCallback(
    async (dir: string) => {
      try {
        const r = await api.openRepo(dir)
        const { tabs: cur } = stateRef.current
        const existing = cur.find((t) => norm(t.path) === norm(r.path))
        const next = existing ? cur : [...cur, r]
        setTabs(next)
        setActive((existing ?? r).path)
        persist(next, (existing ?? r).path)
      } catch (e) {
        ui.toast(`Not a git repository: ${(e as Error).message}`, true)
      }
    },
    [ui]
  )

  const closeTab = useCallback((path?: string) => {
    const { tabs: cur, active: act } = stateRef.current
    const target = path ?? act
    if (!target) return
    const idx = cur.findIndex((t) => t.path === target)
    const next = cur.filter((t) => t.path !== target)
    const nextActive = target === act ? next[Math.min(idx, next.length - 1)]?.path ?? null : act
    setTabs(next)
    setActive(nextActive)
    persist(next, nextActive)
    api.closeRepo(target)
    if (wsOf(stateRef.current.workspaces, target)) saveWorkspaces(withoutRepos(stateRef.current.workspaces, [target]))
  }, [saveWorkspaces])

  const switchTab = useCallback((delta: number | { index: number }) => {
    const { tabs: cur, active: act } = stateRef.current
    if (!cur.length) return
    const idx = cur.findIndex((t) => t.path === act)
    const n = typeof delta === 'number' ? (idx + delta + cur.length) % cur.length : Math.min(delta.index, cur.length - 1)
    setActive(cur[n].path)
    persist(cur, cur[n].path)
  }, [])

  const moveTab = useCallback((path: string, index: number) => {
    const { tabs: cur, active: act } = stateRef.current
    const from = cur.findIndex((t) => t.path === path)
    if (from === -1 || from === index) return
    const next = [...cur]
    const [tab] = next.splice(from, 1)
    next.splice(Math.max(0, Math.min(index, next.length)), 0, tab)
    setTabs(next)
    persist(next, act)
  }, [])

  const selectTab = useCallback((path: string) => {
    setActive(path)
    persist(stateRef.current.tabs, path)
  }, [])

  const register = useCallback((root: string, h: TabHandle | null) => {
    if (h) handles.current.set(norm(root), h)
    else handles.current.delete(norm(root))
  }, [])

  const onInfo = useCallback((root: string, i: TabInfo) => setInfo((prev) => ({ ...prev, [root]: i })), [])

  // ------------------------------------------------------------ boot + events

  useEffect(() => {
    ;(async () => {
      const s = await api.getSettings()
      setTheme(s.theme)
      setKeymap(s.keymap ?? 'default')
      document.documentElement.dataset.theme = s.theme
      const saved = await api.getTabs()
      const opened: RepoSummary[] = []
      for (const t of saved.tabs) {
        try {
          opened.push(await api.openRepo(t.path))
        } catch {
          /* repository moved or deleted */
        }
      }
      setTabs(opened)
      setActive(opened.find((t) => norm(t.path) === norm(saved.active ?? ''))?.path ?? opened[0]?.path ?? null)
      const ws = prune(await api.getWorkspaces(), opened)
      stateRef.current.workspaces = ws
      setWorkspacesState(ws)
      setAppSettings(s)
      setBooting(false)
    })()
  }, [])

  useEffect(
    () =>
      window.ody.on((channel, payload) => {
        if (channel === 'runQueued') runStore.onQueued(payload as RunQueuedEvent)
        else if (channel === 'runStart') runStore.onStart(payload as RunStartEvent)
        else if (channel === 'output') runStore.onOutput(payload as OutputEvent)
        else if (channel === 'hook') runStore.onHook(payload as HookEvent)
        else if (channel === 'runEnd') runStore.onEnd(payload as RunEndEvent)
        else if (channel === 'repoChanged') {
          const p = payload as { root: string; scopes: RefreshScope[] }
          handles.current.get(norm(p.root))?.refresh(p.scopes)
        } else if (channel === 'focus') {
          const a = stateRef.current.active
          if (a) handles.current.get(norm(a))?.refresh(['status', 'refs'])
        }
      }),
    []
  )

  const toggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    await api.setSettings({ theme: next })
  }, [theme])

  // ------------------------------------------------------------ workspaces (tab groups)

  // Remember each group's last tab, so picking the group returns to it.
  useEffect(() => {
    const w = wsOf(workspaces, active)
    if (w && active && w.lastActive !== active) saveWorkspaces(workspaces.map((x) => (x.id === w.id ? { ...x, lastActive: active } : x)))
  }, [active, workspaces, saveWorkspaces])

  const openWorkspace = useCallback((w: Workspace) => {
    const { tabs: cur } = stateRef.current
    const target = cur.find((t) => w.lastActive && norm(t.path) === norm(w.lastActive)) ?? cur.find((t) => wsOf([w], t.path))
    if (target) {
      setActive(target.path)
      persist(cur, target.path)
    }
  }, [])

  const createWorkspace = (name: string, folder: string, repos: string[]): Workspace => {
    const ws = stateRef.current.workspaces
    const w: Workspace = { id: newId(), name, color: nextColor(ws), folder, repos: [] }
    saveWorkspaces(addRepos([...ws, w], w.id, repos))
    return w
  }

  const updateWorkspace = (id: string, patch: Partial<Workspace>) =>
    saveWorkspaces(stateRef.current.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)))

  const newWorkspaceFromFolder = async () => {
    const folder = await api.pickFolder('Workspace folder: its repositories open as one group')
    if (!folder) return
    const found = await api.scanRepos(folder)
    if (!found.length) return void ui.toast('No git repositories in that folder or directly inside it', true)
    const opened = await openRepos(found)
    if (!opened.length) return
    const w = createWorkspace(folder.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace', folder, opened.map((r) => r.path))
    ui.toast(`Workspace ${w.name}: ${opened.length} repositor${opened.length === 1 ? 'y' : 'ies'}`)
  }

  const nameStep = (title: string, value: string, submit: (v: string) => void): Step => ({
    kind: 'input',
    placeholder: 'Workspace name',
    title,
    value,
    submit: (v) => submit(v.trim())
  })

  /** Palette step: put a tab into a group, existing or new. */
  const addToWorkspaceStep = (path: string): Step => ({
    kind: 'list',
    placeholder: 'Add to which workspace?',
    title: 'Workspace',
    items: [
      {
        id: '+new',
        title: 'New workspace…',
        run: () => nameStep('New Workspace', '', (name) => { if (name) createWorkspace(name, commonFolder([path]), [path]) })
      },
      ...stateRef.current.workspaces
        .filter((w) => !w.repos.some((r) => norm(r) === norm(path)))
        .map((w) => ({ id: w.id, title: w.name, detail: w.folder, run: () => saveWorkspaces(addRepos(stateRef.current.workspaces, w.id, [path])) }))
    ]
  })

  const closeWorkspace = (w: Workspace) => {
    for (const r of [...w.repos]) {
      const t = stateRef.current.tabs.find((x) => norm(x.path) === norm(r))
      if (t) closeTab(t.path)
    }
  }

  const changeFolder = async (w: Workspace) => {
    const f = await api.pickFolder(`Folder for ${w.name}'s terminals`)
    if (f) updateWorkspace(w.id, { folder: f })
  }

  const groupMenu = (e: { clientX: number; clientY: number }, w: Workspace): void =>
    ui.menu(e, [
      { label: `Open ${appSettings ? defaultProfile(appSettings).name : 'AI'} in ${w.name}`, action: () => openTerminal(undefined, w) },
      { label: 'Open shell here', action: () => openTerminal({ name: 'Shell', command: '' }, w) },
      { separator: true, label: '' },
      { label: 'Rename…', action: () => openPalette(nameStep('Rename', w.name, (name) => name && updateWorkspace(w.id, { name }))) },
      {
        label: 'Color',
        submenu: Array.from({ length: LANE_COUNT }, (_, i) => ({ label: `${i === w.color ? '● ' : ''}${COLOR_NAMES[i]}`, action: () => updateWorkspace(w.id, { color: i }) }))
      },
      { label: `Folder: ${w.folder}…`, action: () => { changeFolder(w) } },
      { separator: true, label: '' },
      { label: 'Ungroup', action: () => saveWorkspaces(stateRef.current.workspaces.filter((x) => x.id !== w.id)) },
      { label: `Close workspace (${w.repos.length} tab${w.repos.length === 1 ? '' : 's'})`, danger: true, action: () => closeWorkspace(w) }
    ])

  const tabMenu = (e: { clientX: number; clientY: number }, path: string): void => {
    const w = wsOf(stateRef.current.workspaces, path)
    ui.menu(e, [
      {
        label: 'Add to workspace',
        submenu: [
          { label: 'New workspace…', action: () => openPalette(nameStep('New Workspace', '', (name) => { if (name) createWorkspace(name, commonFolder([path]), [path]) })) },
          ...stateRef.current.workspaces
            .filter((x) => x.id !== w?.id)
            .map((x) => ({ label: x.name, action: () => saveWorkspaces(addRepos(stateRef.current.workspaces, x.id, [path])) }))
        ]
      },
      ...(w ? [{ label: `Remove from ${w.name}`, action: () => saveWorkspaces(withoutRepos(stateRef.current.workspaces, [path])) }] : []),
      { separator: true, label: '' },
      { label: 'Close tab', action: () => closeTab(path) }
    ])
  }

  // ------------------------------------------------------------ terminal / AI pane

  const activeWs = wsOf(workspaces, active)
  const activeRepo = tabs.find((t) => t.path === active) ?? null
  const repoScope = (t: RepoSummary): TermScope => ({ key: `repo:${norm(t.path)}`, cwd: t.path, label: t.name, kind: 'repo' })
  const wsScope = (w: Workspace): TermScope => ({ key: `ws:${w.id}`, cwd: w.folder, label: w.name, kind: 'workspace' })
  const scopes: TermScope[] = [...(activeWs ? [wsScope(activeWs)] : []), ...(activeRepo ? [repoScope(activeRepo)] : [])]
  const liveScopes = [...tabs.map((t) => repoScope(t).key), ...workspaces.map((w) => wsScope(w).key)]

  // AI status dots: a tab shows its repository's sessions, a group chip its own and its tabs'.
  const repoAi = (path: string) => aiStates[`repo:${norm(path)}`] ?? null
  const groupAi = (w: Workspace) => aggregateAi([aiStates[`ws:${w.id}`], ...w.repos.map(repoAi)])
  const overallAi = aggregateAi(Object.values(aiStates))
  useEffect(() => {
    api.setAiStatus(overallAi)
  }, [overallAi])

  /** Runs `fn` once the pane has mounted (the first open mounts it), instead of guessing a delay. */
  const withPane = (fn: (h: TerminalHandle) => void, tries = 60) => {
    if (termRef.current) fn(termRef.current)
    else if (tries > 0) setTimeout(() => withPane(fn, tries - 1), 50)
  }

  /** Shows the pane and starts a session: the given program, or the default AI. */
  const openTerminal = (profile?: { name: string; command: string }, w?: Workspace) => {
    if (w && !wsOf([w], stateRef.current.active)) openWorkspace(w)
    setTermUsed(true)
    setTermOpen(true)
    // Let the pane mount (and pick up the new scope) before starting.
    setTimeout(() => withPane((h) => h.start(profile, w ? 'workspace' : undefined)), 30)
  }

  const toggleTerminal = () => {
    if (termOpen) return setTermOpen(false)
    setTermUsed(true)
    setTermOpen(true)
    setTimeout(() => withPane((h) => h.ensure()), 30)
  }

  // ------------------------------------------------------------ commands + shortcuts

  const bindings = bindingsFor(keymap)

  const appCommands = (): Cmd[] => [
    { id: 'tab.new', title: 'Tab: Open Repository in New Tab…', run: () => { api.pickRepo().then((d) => { if (d) openRepo(d) }) } },
    { id: 'tab.close', title: 'Tab: Close Tab', when: !!stateRef.current.active, run: () => closeTab() },
    { id: 'tab.next', title: 'Tab: Next Tab', when: stateRef.current.tabs.length > 1, run: () => switchTab(1) },
    { id: 'tab.prev', title: 'Tab: Previous Tab', when: stateRef.current.tabs.length > 1, run: () => switchTab(-1) },
    ...stateRef.current.tabs.map((t, i) => ({ id: `tab.goto.${t.path}`, title: `Tab: Switch to ${t.name}`, detail: t.path, when: t.path !== stateRef.current.active, run: () => switchTab({ index: i }) })),
    { id: 'repo.open', title: 'Repository: Open…', run: () => { api.pickRepo().then((d) => { if (d) openRepo(d) }) } },

    // AI and terminal pane
    {
      id: 'ai.open',
      title: `AI: Open ${appSettings ? defaultProfile(appSettings).name : 'Default AI'}`,
      detail: activeWs ? `in workspace ${activeWs.name}` : activeRepo ? `in ${activeRepo.name}` : undefined,
      when: !!stateRef.current.active,
      run: () => openTerminal()
    },
    ...(appSettings?.terminalProfiles ?? [])
      .filter((p) => p.command.trim())
      .map((p) => ({ id: `ai.profile.${p.name}`, title: `AI: Open ${p.name}`, cmdline: p.command, when: !!stateRef.current.active, run: () => openTerminal(p) })),
    { id: 'term.shell', title: 'Terminal: New Shell', when: !!stateRef.current.active, run: () => openTerminal({ name: 'Shell', command: '' }) },
    { id: 'view.terminal', title: 'View: Toggle AI / Terminal Pane', when: !!stateRef.current.active, run: () => toggleTerminal() },
    {
      id: 'ai.default',
      title: 'Preferences: Default AI…',
      detail: appSettings?.terminalDefault,
      run: () => ({
        kind: 'list',
        placeholder: 'Program the AI pane starts by default',
        title: 'Default AI',
        items: [{ name: 'Shell', command: '' }, ...(appSettings?.terminalProfiles ?? [])].map((p) => ({
          id: p.name,
          title: p.name,
          cmdline: p.command,
          detail: p.name === appSettings?.terminalDefault ? 'current' : undefined,
          run: () => {
            api.setSettings({ terminalDefault: p.name }).then(setAppSettings)
            ui.toast(`Default AI: ${p.name}`)
          }
        }))
      })
    },

    // workspaces
    { id: 'ws.new', title: 'Workspace: New from Folder…', detail: 'opens every repository in a folder as one group', run: () => { newWorkspaceFromFolder() } },
    { id: 'ws.add', title: 'Workspace: Add Tab to Workspace…', when: !!stateRef.current.active, run: () => addToWorkspaceStep(stateRef.current.active!) },
    { id: 'ws.remove', title: `Workspace: Remove Tab from ${activeWs?.name ?? ''}`, when: !!activeWs, run: () => saveWorkspaces(withoutRepos(stateRef.current.workspaces, [stateRef.current.active!])) },
    ...workspaces.filter((w) => w.id !== activeWs?.id).map((w) => ({ id: `ws.goto.${w.id}`, title: `Workspace: Switch to ${w.name}`, detail: `${w.repos.length} tab(s)`, run: () => openWorkspace(w) })),
    { id: 'ws.rename', title: 'Workspace: Rename…', when: !!activeWs, run: () => nameStep('Rename', activeWs!.name, (name) => name && updateWorkspace(activeWs!.id, { name })) },
    { id: 'ws.folder', title: 'Workspace: Change Folder…', detail: activeWs?.folder, when: !!activeWs, run: () => { changeFolder(activeWs!) } },
    { id: 'ws.close', title: 'Workspace: Close Workspace and Its Tabs', when: !!activeWs, run: () => closeWorkspace(activeWs!) },
    { id: 'app.settings', title: 'Preferences: Settings', detail: 'hook environment, PATH, keymap, diagnostics', run: () => setSettingsOpen(true) },
    { id: 'view.theme', title: 'View: Toggle Paper / Chalkboard Theme', run: () => { toggleTheme() } },
    {
      id: 'app.keymap',
      title: 'Preferences: Keymap…',
      detail: KEYMAP_NAMES[keymap],
      run: () => ({
        kind: 'list',
        placeholder: 'Keyboard shortcut preset',
        title: 'Keymap',
        items: (Object.keys(KEYMAP_NAMES) as Keymap[]).map((k) => ({
          id: k,
          title: KEYMAP_NAMES[k],
          detail: k === keymap ? 'current' : undefined,
          run: () => {
            setKeymap(k)
            api.setSettings({ keymap: k })
            ui.toast(`Keymap: ${KEYMAP_NAMES[k]}`)
          }
        }))
      })
    },
    { id: 'app.shortcuts', title: 'Preferences: Keyboard Shortcuts', detail: KEYMAP_NAMES[keymap], run: () => shortcutsStep() }
  ]

  /** Repo commands (from the active tab) plus app commands, each with its keymap binding. */
  const allCommands = (): Cmd[] => {
    const a = stateRef.current.active
    const repoCmds = a ? handles.current.get(norm(a))?.commands() ?? [] : []
    const ids = new Set(repoCmds.map((c) => c.id))
    return ranked([...repoCmds, ...appCommands().filter((c) => !ids.has(c.id))]).map((c) => ({ ...c, keys: bindings[c.id]?.[0] }))
  }

  const shortcutsStep = (): Step => ({
    kind: 'list',
    placeholder: 'Search shortcuts',
    title: 'Shortcuts',
    items: [{ id: 'app.palette', title: 'Command Palette', run: () => undefined } as Cmd, ...allCommands()]
      .filter((c) => bindings[c.id])
      .map((c) => ({ ...c, keys: undefined, cmdline: bindings[c.id].map(formatKeys).join('  or  '), run: c.run }))
  })

  const openPalette = useCallback((step?: Step) => {
    setPalette(step ?? { kind: 'list', placeholder: 'Type a command…', items: allCommandsRef.current() })
  }, [])
  const allCommandsRef = useRef(allCommands)
  allCommandsRef.current = allCommands

  // Only real palette steps open the palette; any other return value is ignored.
  const isStep = (x: unknown): x is Step => !!x && typeof x === 'object' && ((x as Step).kind === 'list' || (x as Step).kind === 'input')
  const run = (c: Cmd) => Promise.resolve(c.run()).then((step) => { if (isStep(step)) openPalette(step) })

  useEffect(() => {
    let lastShift = 0
    let chord: { first: string; at: number } | null = null
    const onKey = (e: KeyboardEvent) => {
      if (palette || settingsOpen) return
      // Keys typed into the terminal pane belong to the program running there (shells, AI
      // CLIs); only the terminal toggle itself still works.
      if ((e.target as HTMLElement).closest?.('.term-pane')) {
        if (bindings['view.terminal']?.some((k) => matchesKeys(e, k))) {
          const c = allCommandsRef.current().find((x) => x.id === 'view.terminal')
          if (c) {
            e.preventDefault()
            run(c)
          }
        }
        return
      }
      // Double-tap Shift (JetBrains "Search Everywhere")
      if (e.key === 'Shift' && !e.repeat) {
        const now = Date.now()
        if (now - lastShift < 350 && bindings['app.palette']?.includes('Shift Shift')) {
          lastShift = 0
          openPalette()
          return
        }
        lastShift = now
        return
      }
      lastShift = 0
      if (['Control', 'Alt', 'Meta'].includes(e.key)) return

      const inText = (e.target as HTMLElement).closest('input, textarea, select')
      const matches = (combo: string) => {
        if (combo === 'Shift Shift') return false
        const parts = combo.split(' ')
        if (parts.length === 2) {
          if (chord && chord.first === parts[0] && Date.now() - chord.at < 1500) return matchesKeys(e, parts[1])
          return false
        }
        return matchesKeys(e, combo)
      }
      const armChord = () => {
        for (const combos of Object.values(bindings)) {
          for (const combo of combos) {
            const parts = combo.split(' ')
            if (parts.length === 2 && combo !== 'Shift Shift' && matchesKeys(e, parts[0])) {
              chord = { first: parts[0], at: Date.now() }
              e.preventDefault()
              return true
            }
          }
        }
        return false
      }

      if (bindings['app.palette']?.some(matches)) {
        e.preventDefault()
        chord = null
        openPalette()
        return
      }
      // Mod+1..9 jumps to a tab (not in JetBrains, where Alt+digits are tool windows).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && /^[1-9]$/.test(e.key) && keymap !== 'jetbrains') {
        e.preventDefault()
        switchTab({ index: Number(e.key) - 1 })
        return
      }
      for (const c of allCommandsRef.current()) {
        const combos = bindings[c.id]
        if (!combos || c.when === false) continue
        // Text fields keep their own editing keys; only modifier / function-key combos fire.
        if (inText && combos.every((k) => k === 'Mod+Enter' || (!k.includes('Mod') && !/^F\d/.test(k) && !k.includes('Alt')))) continue
        if (inText && combos.includes('Mod+Enter') && matchesKeys(e, 'Mod+Enter')) continue
        if (combos.some(matches)) {
          e.preventDefault()
          chord = null
          run(c)
          return
        }
      }
      if (!armChord()) chord = null
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, settingsOpen, keymap, openPalette])

  if (booting) return <div className="app" />

  const activeTab = tabs.find((t) => t.path === active) ?? null
  const activeInfo = active ? info[active] : undefined

  return (
    <div className="app">
      <TitleBar
        repoName={activeTab?.name ?? null}
        active={active}
        status={activeInfo?.status ?? null}
        parent={activeInfo?.superproject ?? null}
        paletteKeys={bindings['app.palette']?.[0]}
        onParent={() => activeInfo?.superproject && openRepo(activeInfo.superproject)}
        onPalette={() => openPalette()}
        onBranchMenu={() => {
          const c = allCommandsRef.current().find((x) => x.id === 'branch.checkout')
          if (c) run(c)
        }}
        terminalOpen={termOpen}
        aiName={appSettings ? defaultProfile(appSettings).name : 'AI'}
        terminalKeys={bindings['view.terminal']?.[0]}
        onTerminal={() => {
          const c = allCommandsRef.current().find((x) => x.id === 'view.terminal')
          if (c) run(c)
        }}
      />

      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          active={active}
          workspaces={workspaces}
          onSelect={selectTab}
          onClose={closeTab}
          onOpenGroup={openWorkspace}
          repoAi={repoAi}
          groupAi={groupAi}
          onGroupMenu={groupMenu}
          onTabMenu={tabMenu}
          onNew={() => api.pickRepo().then((d) => { if (d) openRepo(d) })}
          onMove={moveTab}
        />
      )}
      <div className="workarea">
      <div className="workarea-main">
      {!activeTab && <Welcome onOpen={openRepo} onWorkspace={() => { newWorkspaceFromFolder() }} />}
      {tabs.map((t) => (
        <RepoView
          key={t.path}
          tab={t}
          active={t.path === active}
          openRepo={openRepo}
          closeTab={() => closeTab(t.path)}
          openPalette={openPalette}
          openSettings={() => setSettingsOpen(true)}
          toggleTheme={toggleTheme}
          register={register}
          onInfo={onInfo}
        />
      ))}
      </div>
      {termUsed && <TerminalPane ref={termRef} scopes={scopes} live={liveScopes} onAiStates={setAiStates} open={termOpen && !!activeTab} onClose={() => setTermOpen(false)} />}
      </div>

      {palette && <Palette initial={palette} onClose={() => setPalette(null)} />}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(s: Settings) => {
            setTheme(s.theme)
            setKeymap(s.keymap)
            setAppSettings(s)
            document.documentElement.dataset.theme = s.theme
            ui.toast('Settings saved')
            if (active) handles.current.get(norm(active))?.refresh(['status', 'refs', 'hooks'])
          }}
        />
      )}
    </div>
  )
}
