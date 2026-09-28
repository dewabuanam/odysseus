import type {
  Branch,
  CommandResult,
  Commit,
  HooksOverview,
  RepoSummary,
  Stash,
  Tag,
  WorkingStatus
} from '@shared/types'
import { api } from './api'
import type { Cmd, Step } from './palette'
import type { AskOptions, AskResult } from './ui'

export type CommitAction = 'focus' | 'commit' | 'commit-no-verify' | 'amend'

export interface CommandDeps {
  repo: RepoSummary | null
  status: WorkingStatus | null
  branches: Branch[]
  tags: Tag[]
  stashes: Stash[]
  commits: Commit[]
  hooks: HooksOverview | null
  exec(fn: () => Promise<CommandResult>, success?: string): Promise<CommandResult>
  mutate(fn: () => Promise<unknown>): Promise<boolean>
  ask(o: AskOptions): Promise<AskResult | null>
  toast(msg: string, error?: boolean): void
  openRepo(dir: string): void
  closeRepo(): void
  select(sha: string): void
  showHooks(hook?: string): void
  commitAction(a: CommitAction): void
  toggleConsole(): void
  toggleSidebar(): void
  toggleTheme(): void
  openSettings(): void
  refresh(): void
}

const input = (placeholder: string, submit: (v: string) => void | Step | Promise<void | Step>, value?: string): Step => ({
  kind: 'input',
  placeholder,
  value,
  submit
})

const list = (placeholder: string, items: Cmd[]): Step => ({ kind: 'list', placeholder, items })

export function branchPicker(d: CommandDeps, placeholder: string, pick: (b: Branch) => void, opts: { remote?: boolean; excludeCurrent?: boolean } = {}): Step {
  const items = d.branches
    .filter((b) => (opts.remote ?? true) || !b.remote)
    .filter((b) => !(opts.excludeCurrent && b.current))
    .map<Cmd>((b) => ({
      id: b.fullRef,
      title: b.name,
      detail: b.current ? 'current' : b.remote ? 'remote' : b.upstream ? `→ ${b.upstream}` : undefined,
      run: () => pick(b)
    }))
  return list(placeholder, items)
}

export function recentPicker(d: CommandDeps): Promise<Step> {
  return api.recentRepos().then((recent) =>
    list(
      'Open recent repository',
      recent.map((r) => ({ id: r.path, title: r.name, detail: r.path, run: () => d.openRepo(r.path) }))
    )
  )
}

export function buildCommands(d: CommandDeps): Cmd[] {
  const has = !!d.repo
  const s = d.status
  const current = d.branches.find((b) => b.current)
  const op = s?.operation ?? null
  const dirty = !!s && s.staged.length + s.unstaged.length + s.conflicted.length > 0

  const checkout = (b: Branch) => (b.remote ? d.exec(() => api.checkoutRemote(b.name)) : d.exec(() => api.checkout(b.name)))

  const push = async (force = false, noVerify = false) => {
    if (!current) return d.toast('Not on a branch', true)
    if (force) {
      const r = await d.ask({ title: `Force push ${current.name}?`, message: 'Uses --force-with-lease: refuses if the remote has commits you have not fetched.', confirmLabel: 'Force push', danger: true })
      if (!r) return
    }
    const remotes = await api.remotes()
    const remote = remotes[0]?.name ?? 'origin'
    d.exec(
      () => api.push(current.upstream ? { force, noVerify } : { remote, branch: current.name, setUpstream: true, force, noVerify }),
      current.upstream ? 'Pushed' : `Pushed and tracking ${remote}/${current.name}`
    )
  }

  const cmds: Cmd[] = [
    // ---------------------------------------------------------------- repository
    { id: 'repo.open', title: 'Repository: Open…', keys: 'Mod+O', run: () => api.pickRepo().then((dir) => { if (dir) d.openRepo(dir) }) },
    { id: 'repo.recent', title: 'Repository: Open Recent…', keys: 'Mod+Shift+O', run: () => recentPicker(d) },
    { id: 'repo.clone', title: 'Repository: Clone…', run: () => input('Repository URL to clone', (url) => { api.cloneRepo(url).then((r) => r && d.openRepo(r.path)).catch((e) => d.toast(e.message, true)) }) },
    { id: 'repo.init', title: 'Repository: New (git init)…', run: () => { api.initRepo().then((r) => r && d.openRepo(r.path)).catch((e) => d.toast(e.message, true)) } },
    { id: 'repo.reveal', title: 'Repository: Show in File Manager', when: has, run: () => { api.openExternal(d.repo!.path) } },
    { id: 'repo.close', title: 'Repository: Close', when: has, run: () => d.closeRepo() },

    // ---------------------------------------------------------------- commit
    { id: 'commit.focus', title: 'Commit: Write Message', detail: 'focus the commit box', keys: 'Mod+Shift+C', when: has, run: () => d.commitAction('focus') },
    { id: 'commit.commit', title: 'Commit: Commit Staged', keys: 'Mod+Enter', when: has && !!s?.staged.length, run: () => d.commitAction('commit') },
    { id: 'commit.noverify', title: 'Commit: Commit Without Hooks (--no-verify)', when: has && !!s?.staged.length, run: () => d.commitAction('commit-no-verify') },
    { id: 'commit.amend', title: 'Commit: Toggle Amend Last Commit', when: has, run: () => d.commitAction('amend') },
    { id: 'stage.all', title: 'Stage: Stage All', keys: 'Mod+Shift+A', when: has && !!s?.unstaged.length, run: () => { d.mutate(() => api.stageAll()) } },
    { id: 'stage.none', title: 'Stage: Unstage All', keys: 'Mod+Shift+U', when: has && !!s?.staged.length, run: () => { d.mutate(() => api.unstageAll()) } },
    {
      id: 'stage.discard',
      title: 'Stage: Discard All Unstaged Changes…',
      when: has && !!s?.unstaged.length,
      run: async () => {
        const r = await d.ask({ title: 'Discard all unstaged changes?', message: 'Modified files are restored and untracked files deleted. This cannot be undone.', confirmLabel: 'Discard all', danger: true })
        if (r && s) d.mutate(() => api.discard(s.unstaged.filter((f) => f.status !== '?').map((f) => f.path), s.unstaged.filter((f) => f.status === '?').map((f) => f.path)))
      }
    },

    // ---------------------------------------------------------------- remote
    { id: 'remote.fetch', title: 'Remote: Fetch All', keys: 'Alt+F', when: has, run: () => { d.exec(() => api.fetch(), 'Fetched') } },
    { id: 'remote.pull', title: 'Remote: Pull', keys: 'Alt+L', when: has, run: () => { d.exec(() => api.pull(false), 'Pulled') } },
    { id: 'remote.pullrebase', title: 'Remote: Pull (Rebase)', when: has, run: () => { d.exec(() => api.pull(true), 'Pulled') } },
    { id: 'remote.push', title: 'Remote: Push', keys: 'Alt+P', when: has, run: () => { push() } },
    { id: 'remote.pushforce', title: 'Remote: Force Push (with lease)…', when: has, run: () => { push(true) } },
    { id: 'remote.pushnoverify', title: 'Remote: Push Without Hooks (--no-verify)', when: has, run: () => { push(false, true) } },

    // ---------------------------------------------------------------- branch
    { id: 'branch.checkout', title: 'Branch: Checkout…', keys: 'Mod+Shift+B', when: has, run: () => branchPicker(d, 'Checkout branch', checkout, { excludeCurrent: true }) },
    {
      id: 'branch.new',
      title: 'Branch: New Branch…',
      keys: 'Mod+B',
      when: has,
      run: () => input(`New branch from ${current?.name ?? 'HEAD'}`, (name) => { d.exec(() => api.createBranch(name.replace(/\s+/g, '-'))) })
    },
    { id: 'branch.merge', title: `Branch: Merge Into ${current?.name ?? 'HEAD'}…`, when: has && !op, run: () => branchPicker(d, `Merge into ${current?.name ?? 'HEAD'}`, (b) => { d.exec(() => api.merge(b.name)) }, { excludeCurrent: true }) },
    { id: 'branch.rebase', title: `Branch: Rebase ${current?.name ?? 'HEAD'} Onto…`, when: has && !op, run: () => branchPicker(d, `Rebase ${current?.name ?? 'HEAD'} onto`, (b) => { d.exec(() => api.rebase(b.name)) }, { excludeCurrent: true }) },
    {
      id: 'branch.delete',
      title: 'Branch: Delete…',
      when: has,
      run: () =>
        branchPicker(
          d,
          'Delete branch',
          async (b) => {
            const r = await d.ask({ title: `Delete branch ${b.name}?`, checkbox: { label: 'Force delete (even if not merged)' }, confirmLabel: 'Delete', danger: true })
            if (r) d.exec(() => api.deleteBranch(b.name, r.checked))
          },
          { remote: false, excludeCurrent: true }
        )
    },
    { id: 'branch.goto', title: 'Go to: Branch…', keys: 'Mod+G', when: has, run: () => branchPicker(d, 'Show branch in history', (b) => d.select(b.sha)) },
    {
      id: 'goto.commit',
      title: 'Go to: Commit…',
      detail: 'search history by message, author or sha',
      keys: 'Mod+Shift+G',
      when: has && d.commits.length > 0,
      run: () =>
        list(
          'Find commit',
          d.commits.slice(0, 5000).map((c) => ({ id: c.sha, title: c.subject, detail: `${c.sha.slice(0, 8)}  ${c.author}`, run: () => d.select(c.sha) }))
        )
    },
    { id: 'goto.working', title: 'Go to: Working Directory', keys: 'Mod+0', when: has, run: () => d.select('working') },

    // ---------------------------------------------------------------- tags & stash
    { id: 'tag.create', title: 'Tag: Create at HEAD…', when: has, run: () => input('Tag name', (name) => { d.exec(() => api.createTag(name, 'HEAD'), `Tagged ${name}`) }) },
    {
      id: 'tag.delete',
      title: 'Tag: Delete…',
      when: has && d.tags.length > 0,
      run: () => list('Delete tag', d.tags.map((t) => ({ id: t.name, title: t.name, run: () => { d.exec(() => api.deleteTag(t.name)) } })))
    },
    { id: 'stash.push', title: 'Stash: Stash Changes…', keys: 'Alt+S', when: has && dirty, run: () => input('Stash message (optional, Enter to stash)', (m) => { d.exec(() => api.stash(m), 'Stashed') }, 'WIP') },
    { id: 'stash.pop', title: 'Stash: Pop Latest', keys: 'Alt+Shift+S', when: has && d.stashes.length > 0, run: () => { d.exec(() => api.stashApply(d.stashes[0].ref, true)) } },
    { id: 'stash.apply', title: 'Stash: Apply…', when: has && d.stashes.length > 0, run: () => list('Apply stash', d.stashes.map((x) => ({ id: x.ref, title: x.message, detail: x.ref, run: () => { d.exec(() => api.stashApply(x.ref, false)) } }))) },
    { id: 'stash.drop', title: 'Stash: Drop…', when: has && d.stashes.length > 0, run: () => list('Drop stash', d.stashes.map((x) => ({ id: x.ref, title: x.message, detail: x.ref, run: () => { d.exec(() => api.stashDrop(x.ref)) } }))) },

    // ---------------------------------------------------------------- operations
    { id: 'op.continue', title: `Operation: Continue ${op ?? ''}`, when: has && !!op, run: () => { d.exec(() => api.continueOperation(op!)) } },
    { id: 'op.abort', title: `Operation: Abort ${op ?? ''}`, when: has && !!op, run: () => { d.exec(() => api.abortOperation(op!)) } },

    // ---------------------------------------------------------------- hooks
    { id: 'hooks.show', title: 'Hooks: Show Hooks', keys: 'Mod+Shift+H', when: has, run: () => d.showHooks() },
    {
      id: 'hooks.run',
      title: 'Hooks: Run Hook Now…',
      detail: 'test a hook without committing',
      when: has && !!d.hooks?.hooks.some((h) => h.enabled),
      run: () =>
        list(
          'Run hook',
          d.hooks!.hooks.filter((h) => h.enabled).map((h) => ({ id: h.name, title: h.name, run: () => { d.exec(() => api.runHook(h.name, ''), `${h.name} passed`) } }))
        )
    },
    {
      id: 'hooks.toggle',
      title: 'Hooks: Enable / Disable Hook…',
      when: has && !!d.hooks?.hooks.some((h) => h.exists),
      run: () =>
        list(
          'Toggle hook',
          d.hooks!.hooks.filter((h) => h.exists).map((h) => ({
            id: h.name,
            title: h.name,
            detail: h.enabled ? 'enabled, select to disable' : 'disabled, select to enable',
            run: () => { d.mutate(() => api.setHookEnabled(h.name, !h.enabled)).then((ok) => ok && d.toast(`${h.name} ${h.enabled ? 'disabled' : 'enabled'}`)) }
          }))
        )
    },
    {
      id: 'hooks.edit',
      title: 'Hooks: Edit Hook…',
      when: has && !!d.hooks,
      run: () => list('Edit hook', (d.hooks?.hooks ?? []).map((h) => ({ id: h.name, title: h.name, detail: h.exists ? (h.enabled ? 'active' : 'disabled') : 'not installed', run: () => d.showHooks(h.name) })))
    },

    // ---------------------------------------------------------------- view
    { id: 'view.console', title: 'View: Toggle Hook Console', keys: 'Mod+`', run: () => d.toggleConsole() },
    { id: 'view.sidebar', title: 'View: Toggle Sidebar', keys: 'Mod+\\', when: has, run: () => d.toggleSidebar() },
    { id: 'view.theme', title: 'View: Toggle Light / Dark Theme', run: () => d.toggleTheme() },
    { id: 'view.refresh', title: 'View: Refresh', keys: 'F5', when: has, run: () => d.refresh() },
    { id: 'app.settings', title: 'Preferences: Settings', detail: 'hook environment, PATH, timeout, diagnostics', keys: 'Mod+,', run: () => d.openSettings() }
  ]
  return cmds
}
