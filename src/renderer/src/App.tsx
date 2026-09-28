import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HookEvent,
  Keymap,
  OutputEvent,
  RepoSummary,
  RunEndEvent,
  RunQueuedEvent,
  RunStartEvent,
  Settings
} from '@shared/types'
import { api } from './api'
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
  const handles = useRef(new Map<string, TabHandle>())
  const stateRef = useRef({ tabs, active })
  stateRef.current = { tabs, active }

  // ------------------------------------------------------------ tabs

  const persist = (t: RepoSummary[], a: string | null) => api.setTabs(t.map((x) => x.path), a)

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
  }, [])

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

  // ------------------------------------------------------------ commands + shortcuts

  const bindings = bindingsFor(keymap)

  const appCommands = (): Cmd[] => [
    { id: 'tab.new', title: 'Tab: Open Repository in New Tab…', run: () => { api.pickRepo().then((d) => { if (d) openRepo(d) }) } },
    { id: 'tab.close', title: 'Tab: Close Tab', when: !!stateRef.current.active, run: () => closeTab() },
    { id: 'tab.next', title: 'Tab: Next Tab', when: stateRef.current.tabs.length > 1, run: () => switchTab(1) },
    { id: 'tab.prev', title: 'Tab: Previous Tab', when: stateRef.current.tabs.length > 1, run: () => switchTab(-1) },
    ...stateRef.current.tabs.map((t, i) => ({ id: `tab.goto.${t.path}`, title: `Tab: Switch to ${t.name}`, detail: t.path, when: t.path !== stateRef.current.active, run: () => switchTab({ index: i }) })),
    { id: 'repo.open', title: 'Repository: Open…', run: () => { api.pickRepo().then((d) => { if (d) openRepo(d) }) } },
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
    return [...repoCmds, ...appCommands().filter((c) => !ids.has(c.id))].map((c) => ({ ...c, keys: bindings[c.id]?.[0] }))
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
      />

      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          active={active}
          onSelect={selectTab}
          onClose={closeTab}
          onNew={() => api.pickRepo().then((d) => { if (d) openRepo(d) })}
          onMove={moveTab}
        />
      )}
      {!activeTab && <Welcome onOpen={openRepo} />}
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

      {palette && <Palette initial={palette} onClose={() => setPalette(null)} />}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(s: Settings) => {
            setTheme(s.theme)
            setKeymap(s.keymap)
            document.documentElement.dataset.theme = s.theme
            ui.toast('Settings saved')
            if (active) handles.current.get(norm(active))?.refresh(['status', 'refs', 'hooks'])
          }}
        />
      )}
    </div>
  )
}
