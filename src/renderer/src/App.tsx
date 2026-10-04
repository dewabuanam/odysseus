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
import { aggregateAi, type AiCommand, type AiState } from '@shared/types'
import { AI_LABEL } from './aiState'
import { api } from './api'
import { ranked } from './commands'
import { bindingsFor, KEYMAP_NAMES } from './keymaps'
import { formatKeys, matchesKeys, Palette, type Cmd, type Step } from './palette'
import type { RefreshScope } from './repoContext'
import { RepoView, type TabHandle, type TabInfo } from './RepoView'
import { norm, runStore } from './runs'
import { UiProvider, useUi } from './ui'
import { SettingsDialog } from './components/SettingsDialog'
import { AboutDialog, HOMEPAGE } from './components/AboutDialog'
import { TabBar } from './components/TabBar'
import { TitleBar } from './components/TitleBar'
import { Welcome } from './components/Welcome'
import { defaultProfile, hasRemote, TerminalPane, type OpenSession, type TerminalHandle, type TermScope } from './components/TerminalPane'
import { addRepos, commonFolder, newId, nextColor, prune, withoutRepos, wsOf, LANE_COUNT } from './workspaces'

const AI_BADGE: Record<AiState, string> = { waiting: '#d93a32', working: '#e0a400', idle: '#2f9a4f' }

/**
 * Taskbar overlay: a dot in the most urgent state's color with the number of AI sessions
 * still working, so "2 working, 1 waiting for you" reads as a red dot with a 2.
 */
function aiBadge(state: AiState, working: number): string {
  const size = 32
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  g.fillStyle = '#ffffff'
  g.fill()
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2 - 3.5, 0, Math.PI * 2)
  g.fillStyle = AI_BADGE[state]
  g.fill()
  if (working > 0) {
    const text = working > 9 ? '9+' : String(working)
    g.fillStyle = '#ffffff'
    g.font = `bold ${text.length > 1 ? 15 : 20}px "Segoe UI", Arial, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, size / 2, size / 2 + 1)
  }
  return c.toDataURL('image/png')
}

const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Orange', 'Purple', 'Teal', 'Brown', 'Pink']

/** "Claude Code" reads as "Claude" in command titles. */
const aiShortName = (name: string) => name.replace(/\s+(code|cli)$/i, '')

/** `pr:pr-review` reads as "Pr Review", `commit` as "Commit". */
const commandTitle = (name: string) =>
  (name.split(':').pop() ?? name)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

const sameStates = (a: Record<string, AiState>, b: Record<string, AiState>) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

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
  const [aboutOpen, setAboutOpen] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [keymap, setKeymap] = useState<Keymap>('default')
  /** Installed from the Microsoft Store: the Store updates it, so there's no releases page to check */
  const [isStore, setIsStore] = useState(false)
  useEffect(() => {
    api.isStore().then(setIsStore, () => {})
  }, [])
  const [workspaces, setWorkspacesState] = useState<Workspace[]>([])
  const [appSettings, setAppSettings] = useState<Settings | null>(null)
  const [termOpen, setTermOpen] = useState(false)
  // Mounted from the start so the default AI can boot in the background before it's opened.
  const [termUsed, setTermUsed] = useState(true)
  const [aiStates, setAiStates] = useState<Record<string, AiState>>({})
  const [aiWorking, setAiWorking] = useState(0)
  /** An AI session (not a shell) is working: Windows must not go idle and lock meanwhile */
  const [aiBusy, setAiBusy] = useState(false)
  /** Slash commands the default AI offers where the AI pane opens */
  const [aiCmds, setAiCmds] = useState<AiCommand[]>([])
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

  /** A tab or a group dragged to a new place in the tab row: the new order, and its groups when a tab joined or left one. */
  const reorderTabs = useCallback((next: RepoSummary[], ws: Workspace[]) => {
    setTabs(next)
    persist(next, stateRef.current.active)
    if (ws !== stateRef.current.workspaces) saveWorkspaces(ws)
  }, [saveWorkspaces])

  const selectTab = useCallback((path: string) => {
    setActive(path)
    persist(stateRef.current.tabs, path)
  }, [])

  const register = useCallback((root: string, h: TabHandle | null) => {
    if (h) handles.current.set(norm(root), h)
    else handles.current.delete(norm(root))
  }, [])

  const onInfo = useCallback((root: string, i: TabInfo) => setInfo((prev) => ({ ...prev, [root]: i })), [])
  const openSettings = useCallback(() => setSettingsOpen(true), [])

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
      let ws = prune(await api.getWorkspaces(), opened)
      // Collapsed groups used to be kept in local storage; they're saved with the groups now.
      try {
        const old = localStorage.getItem('odysseus.collapsedWorkspaces')
        if (old) {
          const ids: string[] = JSON.parse(old)
          ws = ws.map((w) => (ids.includes(w.id) ? { ...w, collapsed: true } : w))
          api.setWorkspaces(ws)
          localStorage.removeItem('odysseus.collapsedWorkspaces')
        }
      } catch {
        /* storage unavailable */
      }
      stateRef.current.workspaces = ws
      setWorkspacesState(ws)
      setAppSettings(s)
      if ((await api.getAiPane()).open) setTermOpen(true)
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

  // Workspace groups the user collapsed in the tab row (saved with the groups); the others stay expanded.
  const collapsedWs = workspaces.filter((w) => w.collapsed).map((w) => w.id)
  const setCollapsed = (id: string, collapsed: boolean) =>
    saveWorkspaces(stateRef.current.workspaces.map((w) => (w.id === id ? { ...w, collapsed: collapsed || undefined } : w)))

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

  const newWorkspaceFromFolder = async (given?: string) => {
    const folder = given ?? (await api.pickFolder('Workspace folder: its repositories open as one group'))
    if (!folder) return
    const found = await api.scanRepos(folder)
    if (!found.length) return void ui.toast('No git repositories in that folder or directly inside it', true)
    const opened = await openRepos(found)
    if (!opened.length) return
    const w = createWorkspace(folder.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace', folder, opened.map((r) => r.path))
    ui.toast(`Workspace ${w.name}: ${opened.length} repositor${opened.length === 1 ? 'y' : 'ies'}`)
  }

  /**
   * A folder dropped on the window: a repository opens as a tab, a folder of repositories as
   * a workspace, and a folder inside a repository opens that repository.
   */
  const openDroppedFolder = async (folder: string) => {
    const found = await api.scanRepos(folder)
    if (found.length === 1 && norm(found[0]) === norm(folder)) return openRepo(folder)
    if (found.length) return newWorkspaceFromFolder(folder)
    try {
      await api.openRepo(folder)
    } catch {
      return void ui.toast(`${folder} is not a git repository and has none directly inside it`, true)
    }
    return openRepo(folder)
  }
  const openDroppedRef = useRef(openDroppedFolder)
  openDroppedRef.current = openDroppedFolder

  // Files dropped on the window open in editor windows; folders open as repositories or workspaces.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const drop = async (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length) return
      e.preventDefault()
      for (const f of files) {
        const p = window.ody.pathForFile(f)
        const kind = p ? await api.pathKind(p) : null
        if (kind === 'file') api.openEditor(p)
        else if (kind === 'dir') await openDroppedRef.current(p)
      }
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  /** Picks (or makes) a folder and runs `git init` there. */
  const newRepository = async () => {
    try {
      const r = await api.initRepo()
      if (r) openRepo(r.path)
    } catch (e) {
      ui.toast((e as Error).message, true)
    }
  }

  const cloneRepository = async () => {
    const a = await ui.ask({ title: 'Clone repository', input: { label: 'Repository URL', placeholder: 'https://github.com/user/repo.git' }, confirmLabel: 'Choose folder & clone' })
    if (!a?.value.trim()) return
    try {
      const r = await api.cloneRepo(a.value.trim())
      if (r) openRepo(r.path)
    } catch (e) {
      ui.toast((e as Error).message, true)
    }
  }

  /**
   * A named group for a folder (made in the picker if it's new). Its repositories open as the
   * group's tabs; an empty folder gets a first repository, since a group lives on its tabs.
   */
  const newWorkspace = async () => {
    const folder = await api.pickFolder('Folder for the new workspace', true)
    if (!folder) return
    const named = await ui.ask({ title: 'New workspace', input: { label: 'Name', value: folder.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace' }, confirmLabel: 'Create' })
    const name = named?.value.trim()
    if (!name) return
    let found = await api.scanRepos(folder)
    if (!found.length) {
      const first = await ui.ask({
        title: `New workspace ${name}`,
        message: `${folder} has no repositories yet. Create the first one inside it:`,
        input: { label: 'Repository name', placeholder: 'my-project' },
        confirmLabel: 'Create repository'
      })
      const repo = first?.value.trim()
      if (!repo) return
      try {
        const sep = folder.includes('\\') ? '\\' : '/'
        found = [(await api.initRepoAt(`${folder.replace(/[\\/]+$/, '')}${sep}${repo}`)).path]
      } catch (e) {
        return void ui.toast((e as Error).message, true)
      }
    }
    const opened = await openRepos(found)
    if (!opened.length) return
    createWorkspace(name, folder, opened.map((r) => r.path))
    ui.toast(`Workspace ${name}: ${opened.length} repositor${opened.length === 1 ? 'y' : 'ies'}`)
  }

  /** The tab row's + button. */
  const newMenu = (e: { clientX: number; clientY: number }): void =>
    ui.menu(e, [
      { label: 'New repository…', action: () => { newRepository() } },
      { label: 'Open repository…', action: () => { api.pickRepo().then((d) => { if (d) openRepo(d) }) } },
      { label: 'Clone repository…', action: () => { cloneRepository() } },
      { separator: true, label: '' },
      { label: 'New workspace…', action: () => { newWorkspace() } },
      { label: 'Open workspace folder…', action: () => { newWorkspaceFromFolder() } }
    ])

  const nameStep = (title: string, value: string, submit: (v: string) => void): Step => ({
    kind: 'input',
    placeholder: 'Workspace name',
    title,
    value,
    submit: (v) => submit(v.trim())
  })

  /** Palette step: name a repository in Odysseus (its tab, the AI pane, recent list). */
  const aliasStep = (path: string): Step => {
    const t = stateRef.current.tabs.find((x) => x.path === path)
    const folder = path.split(/[\\/]/).filter(Boolean).pop() ?? path
    return {
      kind: 'input',
      title: 'Rename Repository',
      placeholder: `Name for ${folder}; leave empty for the folder name`,
      allowEmpty: true,
      value: t?.name ?? folder,
      submit: async (v: string) => {
        const r = await api.setAlias(path, v.trim())
        setTabs((cur) => cur.map((x) => (x.path === path ? { ...x, name: r.name } : x)))
      }
    }
  }

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

  /** Opens a repository (picked starting in the group's folder) and puts it in the group, next to its other tabs. */
  const addRepoToWorkspace = async (w: Workspace) => {
    const dir = await api.pickRepo(`Add a repository to ${w.name}`, w.folder)
    if (!dir) return
    let r: RepoSummary
    try {
      r = await api.openRepo(dir)
    } catch (e) {
      return void ui.toast(`Not a git repository: ${(e as Error).message}`, true)
    }
    const { tabs: cur, workspaces: ws } = stateRef.current
    const existing = cur.find((t) => norm(t.path) === norm(r.path))
    const tab = existing ?? r
    const nextWs = addRepos(ws, w.id, [tab.path])
    const g = nextWs.find((x) => x.id === w.id)
    // Place the tab after the group's last tab in the row.
    const others = cur.filter((t) => t !== existing)
    const last = others.reduce((at, t, i) => (g && wsOf([g], t.path) ? i : at), -1)
    const next = last === -1 ? [...others, tab] : [...others.slice(0, last + 1), tab, ...others.slice(last + 1)]
    saveWorkspaces(nextWs)
    if (w.collapsed) setCollapsed(w.id, false)
    setTabs(next)
    setActive(tab.path)
    persist(next, tab.path)
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
      { label: 'Add repository…', action: () => { addRepoToWorkspace(w) } },
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
      { label: 'Rename…', action: () => openPalette(aliasStep(path)) },
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
    api.setAiStatus(overallAi, overallAi ? aiBadge(overallAi, aiWorking) : null, aiWorking)
  }, [overallAi, aiWorking])
  useEffect(() => {
    api.keepAwake(aiBusy)
  }, [aiBusy])

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

  /** Shows the pane and types `text` into the default AI, starting it when none is running. */
  const sendToAi = (text: string) => {
    setTermUsed(true)
    setTermOpen(true)
    setTimeout(() => withPane((h) => h.send(text)), 30)
  }

  const aiProfile = appSettings ? defaultProfile(appSettings) : null
  const aiCwd = scopes[0]?.cwd ?? ''
  useEffect(() => {
    if (!aiProfile?.command.trim() || !aiCwd) return setAiCmds([])
    let live = true
    api.aiCommands(aiProfile.command, aiCwd).then((c) => live && setAiCmds(c), () => live && setAiCmds([]))
    return () => {
      live = false
    }
  }, [aiProfile?.command, aiCwd])

  /** "Claude: Commit" types `/commit`, plus whatever you add after it, into the default AI. */
  const aiSlashCommands = (): Cmd[] => {
    if (!aiProfile?.command.trim()) return []
    const ai = aiShortName(aiProfile.name)
    return aiCmds.map((c) => ({
      id: `ai.cmd.${c.name}`,
      title: `${ai}: ${commandTitle(c.name)}`,
      detail: c.description ? `${c.description}${c.source === 'built-in' ? '' : ` (${c.source})`}` : c.source,
      cmdline: `/${c.name}`,
      when: !!stateRef.current.active,
      run: () => ({
        kind: 'input',
        title: `${ai} /${c.name}`,
        placeholder: `Text after /${c.name} (optional), Enter to send to ${ai}`,
        allowEmpty: true,
        submit: (v: string) => sendToAi(`/${c.name}${v.trim() ? ` ${v.trim()}` : ''}`)
      })
    }))
  }

  /** Where a session runs, as the palette names it: "odysseus in workspace Tools", "workspace Tools". */
  const placeName = (scope: string): string => {
    const { tabs: cur, workspaces: ws } = stateRef.current
    if (scope.startsWith('ws:')) return `workspace ${ws.find((w) => `ws:${w.id}` === scope)?.name ?? ''}`
    const t = cur.find((x) => repoScope(x).key === scope)
    const w = t && wsOf(ws, t.path)
    return `${t?.name ?? ''}${w ? ` in workspace ${w.name}` : ''}`
  }

  /** Opens the tab or workspace a session runs in, shows the pane and brings the session into view. */
  const gotoSession = (s: OpenSession) => {
    const { tabs: cur, workspaces: ws } = stateRef.current
    const w = s.scope.startsWith('ws:') ? ws.find((x) => `ws:${x.id}` === s.scope) : undefined
    const t = w ? undefined : cur.find((x) => repoScope(x).key === s.scope)
    if (w && !wsOf([w], stateRef.current.active)) openWorkspace(w)
    if (t) {
      setActive(t.path)
      persist(cur, t.path)
    }
    setTermUsed(true)
    setTermOpen(true)
    setTimeout(() => withPane((h) => h.focus(s.key)), 30)
  }

  const stateNote = (a: AiState | null) => (a ? AI_LABEL[a] : undefined)
  const tabDetail = (t: RepoSummary) => {
    const w = wsOf(stateRef.current.workspaces, t.path)
    return [w && `workspace ${w.name}`, stateNote(repoAi(t.path)), t.path].filter(Boolean).join(' · ')
  }

  /** One palette entry per open shell or AI session, named with the repository or workspace it runs in. */
  const sessionCommands = (): Cmd[] =>
    (termRef.current?.sessions() ?? []).map((s) => ({
      id: `session.goto.${s.key}`,
      title: `${s.shell ? 'Terminal' : 'AI'}: Go to ${s.title} in ${placeName(s.scope)}`,
      detail: s.exited ? 'exited' : stateNote(s.ai),
      run: () => gotoSession(s)
    }))

  /** Everything open in one list: tabs, workspaces, and the shells and AIs running in them. */
  const gotoStep = (): Step => ({
    kind: 'list',
    title: 'Go to',
    placeholder: 'Open tab, workspace, shell or AI',
    items: [
      ...stateRef.current.tabs.map((t, i) => ({ id: `goto.tab.${t.path}`, title: t.name, detail: `tab · ${tabDetail(t)}`, run: () => switchTab({ index: i }) })),
      ...stateRef.current.workspaces.map((w) => ({ id: `goto.ws.${w.id}`, title: w.name, detail: [`workspace · ${w.repos.length} tab(s)`, stateNote(groupAi(w))].filter(Boolean).join(' · '), run: () => openWorkspace(w) })),
      ...(termRef.current?.sessions() ?? []).map((s) => ({
        id: `goto.session.${s.key}`,
        title: `${s.title} in ${placeName(s.scope)}`,
        detail: [s.shell ? 'shell' : 'AI', s.exited ? 'exited' : stateNote(s.ai)].filter(Boolean).join(' · '),
        run: () => gotoSession(s)
      }))
    ]
  })

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
    { id: 'app.goto', title: 'Go to: Open Tab, Workspace, Shell or AI…', detail: 'anything already open', run: () => gotoStep() },
    ...stateRef.current.tabs.map((t, i) => ({ id: `tab.goto.${t.path}`, title: `Tab: Switch to ${t.name}`, detail: tabDetail(t), when: t.path !== stateRef.current.active, run: () => switchTab({ index: i }) })),
    { id: 'repo.open', title: 'Repository: Open…', run: () => { api.pickRepo().then((d) => { if (d) openRepo(d) }) } },
    { id: 'repo.init', title: 'Repository: Create New…', detail: 'git init in a new or empty folder', run: () => { newRepository() } },
    { id: 'repo.clone', title: 'Repository: Clone…', run: () => { cloneRepository() } },

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
    {
      id: 'ai.remote',
      title: 'AI: Toggle Remote Control Here',
      detail: 'for the repository or workspace in the AI pane; continue Claude Code sessions from claude.ai or the Claude app',
      when: !!aiProfile && hasRemote(aiProfile),
      run: () => withPane((h) => h.toggleRemote())
    },
    {
      id: 'ai.remote.default',
      title: `AI: Turn Remote Control ${appSettings?.remoteControl ? 'Off' : 'On'} by Default`,
      detail: 'for every repository and workspace without its own setting',
      when: !!aiProfile && hasRemote(aiProfile),
      run: () => withPane((h) => h.toggleRemoteDefault())
    },
    ...aiSlashCommands(),
    ...sessionCommands(),
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
    { id: 'ws.create', title: 'Workspace: Create New…', detail: 'a named group for a folder; starts its first repository if it has none', run: () => { newWorkspace() } },
    { id: 'ws.new', title: 'Workspace: New from Folder…', detail: 'opens every repository in a folder as one group', run: () => { newWorkspaceFromFolder() } },
    { id: 'ws.add', title: 'Workspace: Add Tab to Workspace…', when: !!stateRef.current.active, run: () => addToWorkspaceStep(stateRef.current.active!) },
    { id: 'ws.remove', title: `Workspace: Remove Tab from ${activeWs?.name ?? ''}`, when: !!activeWs, run: () => saveWorkspaces(withoutRepos(stateRef.current.workspaces, [stateRef.current.active!])) },
    ...workspaces.filter((w) => w.id !== activeWs?.id).map((w) => ({ id: `ws.goto.${w.id}`, title: `Workspace: Switch to ${w.name}`, detail: [`${w.repos.length} tab(s)`, stateNote(groupAi(w))].filter(Boolean).join(' · '), run: () => openWorkspace(w) })),
    { id: 'tab.rename', title: 'Tab: Rename Repository…', detail: 'a name for it in Odysseus; the folder stays as it is', when: !!stateRef.current.active, run: () => aliasStep(stateRef.current.active!) },
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
    { id: 'help.about', title: 'Help: About Odysseus', detail: 'version, Git and runtime versions', run: () => setAboutOpen(true) },
    { id: 'help.releases', title: 'Help: Check for Updates', detail: 'opens the releases page', when: !isStore, run: () => { api.openUrl(`${HOMEPAGE}/releases`) } },
    { id: 'help.homepage', title: 'Help: Odysseus on GitHub', run: () => { api.openUrl(HOMEPAGE) } },
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
    const inTerm = (e: KeyboardEvent) => !!(e.target as HTMLElement).closest?.('.term-pane')
    const onKey = (e: KeyboardEvent) => {
      if (palette || settingsOpen || aboutOpen) return
      // Double-tap Shift (JetBrains "Search Everywhere"); not in the terminal, where typing
      // capitals would trip it.
      if (e.key === 'Shift' && !e.repeat && !inTerm(e)) {
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
    const onBubble = (e: KeyboardEvent) => {
      if (!inTerm(e)) onKey(e)
    }
    // App shortcuts take priority over the terminal pane (shells, AI CLIs): match them in the
    // capture phase, before xterm turns the key into input, and keep handled keys from it.
    const onCapture = (e: KeyboardEvent) => {
      if (!inTerm(e)) return
      onKey(e)
      if (e.defaultPrevented) e.stopPropagation()
    }
    window.addEventListener('keydown', onBubble)
    window.addEventListener('keydown', onCapture, true)
    return () => {
      window.removeEventListener('keydown', onBubble)
      window.removeEventListener('keydown', onCapture, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette, settingsOpen, aboutOpen, keymap, openPalette])

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
        onAbout={() => setAboutOpen(true)}
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
          collapsed={collapsedWs}
          onOpenGroup={(w) => {
            setCollapsed(w.id, false)
            openWorkspace(w)
          }}
          onCollapseGroup={(w) => {
            setCollapsed(w.id, true)
            if (stateRef.current.active && wsOf([w], stateRef.current.active)) {
              setActive(null)
              persist(stateRef.current.tabs, null)
            }
          }}
          repoAi={repoAi}
          groupAi={groupAi}
          onGroupMenu={groupMenu}
          onTabMenu={tabMenu}
          onNew={newMenu}
          onReorder={reorderTabs}
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
          closeTab={closeTab}
          openPalette={openPalette}
          openSettings={openSettings}
          toggleTheme={toggleTheme}
          register={register}
          onInfo={onInfo}
        />
      ))}
      </div>
      {termUsed && <TerminalPane ref={termRef} scopes={scopes} live={liveScopes} ready={!booting} onAiStates={(s, n, ai) => {
            // Same states as before: skip re-rendering the app.
            setAiStates((prev) => (sameStates(prev, s) ? prev : s))
            setAiWorking(n)
            setAiBusy(ai > 0)
          }} appSettings={appSettings} onSettings={setAppSettings} open={termOpen && !!activeTab} wanted={termOpen} onClose={() => setTermOpen(false)} />}
      </div>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

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
