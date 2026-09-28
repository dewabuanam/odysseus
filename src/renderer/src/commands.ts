import type {
  Branch,
  CommandResult,
  Commit,
  HooksOverview,
  Remote,
  RepoSummary,
  Stash,
  Submodule,
  Tag,
  WorkingStatus
} from '@shared/types'
import type { RepoApi } from './api'
import type { Cmd, Step, Suggestion } from './palette'
import type { AskOptions, AskResult } from './ui'

export interface CommitRequest {
  message: string
  amend?: boolean
  noVerify?: boolean
  signoff?: boolean
}

export type CommitAction = 'focus' | 'commit' | 'commit-no-verify' | 'amend' | CommitRequest

export interface CommandDeps {
  api: RepoApi
  repo: RepoSummary | null
  status: WorkingStatus | null
  branches: Branch[]
  tags: Tag[]
  stashes: Stash[]
  remotes: Remote[]
  commits: Commit[]
  hooks: HooksOverview | null
  submodules: Submodule[]
  superproject: string | null
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
  find(): void
  showHistory(): void
}

// ------------------------------------------------------------------ step helpers

type Next = void | Step | Promise<void | Step>

export const list = (placeholder: string, items: Cmd[], title?: string): Step => ({ kind: 'list', placeholder, items, title })

export const input = (
  placeholder: string,
  submit: (v: string) => Next,
  opts: { value?: string; suggestions?: Suggestion[]; title?: string; allowEmpty?: boolean } = {}
): Step => ({ kind: 'input', placeholder, submit, ...opts })

/** A list of variants of one git command; each shows the exact command line it runs. */
export const options = (placeholder: string, items: { id: string; title: string; cmdline: string; detail?: string; run(): Next }[]): Step =>
  list(placeholder, items)

const draftKey = (root: string) => `odysseus.draft.${root}`
function readDraft(root: string): string {
  try {
    return localStorage.getItem(draftKey(root)) ?? ''
  } catch {
    return ''
  }
}

const CONVENTIONAL: Suggestion[] = [
  { value: 'feat: ', detail: 'a new feature' },
  { value: 'fix: ', detail: 'a bug fix' },
  { value: 'chore: ', detail: 'tooling, deps, housekeeping' },
  { value: 'refactor: ', detail: 'code change without behaviour change' },
  { value: 'docs: ', detail: 'documentation only' },
  { value: 'test: ', detail: 'adding or fixing tests' },
  { value: 'perf: ', detail: 'performance improvement' },
  { value: 'style: ', detail: 'formatting, whitespace' },
  { value: 'ci: ', detail: 'CI configuration' },
  { value: 'build: ', detail: 'build system' }
]

const BRANCH_PREFIXES: Suggestion[] = [
  { value: 'feature/', detail: 'new feature' },
  { value: 'fix/', detail: 'bug fix' },
  { value: 'hotfix/', detail: 'urgent production fix' },
  { value: 'chore/', detail: 'maintenance' },
  { value: 'release/', detail: 'release preparation' },
  { value: 'experiment/', detail: 'throwaway exploration' }
]

/** Next semantic versions after the newest tag that looks like one. */
function nextVersions(tags: Tag[]): Suggestion[] {
  const semver = tags.map((t) => t.name.match(/^(v?)(\d+)\.(\d+)\.(\d+)$/)).find(Boolean)
  if (!semver) return [{ value: 'v0.1.0', detail: 'first release' }, { value: 'v1.0.0', detail: 'first stable release' }]
  const [, v, a, b, c] = semver
  const [maj, min, pat] = [Number(a), Number(b), Number(c)]
  return [
    { value: `${v}${maj}.${min}.${pat + 1}`, detail: `patch after ${semver[0]}` },
    { value: `${v}${maj}.${min + 1}.0`, detail: `minor after ${semver[0]}` },
    { value: `${v}${maj + 1}.0.0`, detail: `major after ${semver[0]}` }
  ]
}

const repoName = (url: string) => url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:\\]/).pop() || 'module'

// ------------------------------------------------------------------ pickers

export function branchPicker(
  d: CommandDeps,
  placeholder: string,
  pick: (b: Branch) => Next,
  opts: { remote?: boolean; excludeCurrent?: boolean; cmd?: (b: Branch) => string } = {}
): Step {
  const items = d.branches
    .filter((b) => (opts.remote ?? true) || !b.remote)
    .filter((b) => !(opts.excludeCurrent && b.current))
    .map<Cmd>((b) => ({
      id: b.fullRef,
      title: b.name,
      detail: b.current ? 'current' : b.remote ? 'remote' : b.upstream ? `tracks ${b.upstream}` : undefined,
      cmdline: opts.cmd?.(b),
      run: () => pick(b)
    }))
  return list(placeholder, items)
}

export function recentPicker(d: CommandDeps): Promise<Step> {
  return d.api.recentRepos().then((recent) =>
    list(
      'Open recent repository',
      recent.map((r) => ({ id: r.path, title: r.name, detail: r.path, run: () => d.openRepo(r.path) })),
      'Open Recent'
    )
  )
}

/** Name, then email, then where to save it. Offered automatically when git refuses to commit. */
export function identityFlow(d: CommandDeps, reason?: string): Step {
  return input(
    reason ?? 'Your name for commits',
    (name) =>
      input('Your email for commits', (email) =>
        options('Save the identity where?', [
          { id: 'repo', title: 'This repository only', cmdline: 'git config user.name / user.email', run: () => { d.api.setIdentity(name, email, false).then(() => d.toast(`Commits here are now by ${name}`)) } },
          { id: 'global', title: 'All repositories (global)', cmdline: 'git config --global user.name / user.email', run: () => { d.api.setIdentity(name, email, true).then(() => d.toast(`Commits are now by ${name}`)) } }
        ]),
      { title: name }),
    { title: 'Identity' }
  )
}

// ------------------------------------------------------------------ commands

export function buildCommands(d: CommandDeps): Cmd[] {
  const has = !!d.repo
  const s = d.status
  const current = d.branches.find((b) => b.current)
  const cur = current?.name ?? 'HEAD'
  const op = s?.operation ?? null
  const dirty = !!s && s.staged.length + s.unstaged.length + s.conflicted.length > 0
  const remote = current?.upstream?.split('/')[0] ?? d.remotes[0]?.name ?? 'origin'
  const initialized = d.submodules.filter((m) => m.state !== 'uninitialized')

  // ---------------------------------------------------------------- flows

  const commitFlow = (): Step => {
    const message = (req: Omit<CommitRequest, 'message'>, label: string) => async (): Promise<Step> => {
      const draft = readDraft(d.repo!.path)
      const last = req.amend ? await d.api.lastCommitMessage() : ''
      const value = draft.split('\n')[0] || last.split('\n')[0]
      const suggestions = [...(last ? [{ value: last.split('\n')[0], detail: 'last commit message' }] : []), ...CONVENTIONAL]
      return input(
        req.amend ? 'Amended commit message' : 'Commit message (summary line)',
        (msg) => {
          // Keep any body lines from the draft when the summary is edited in the palette.
          const body = draft.split('\n').slice(1).join('\n').trim()
          d.commitAction({ ...req, message: body && draft.split('\n')[0] === value ? `${msg}\n\n${body}` : msg })
        },
        { value, suggestions, title: label }
      )
    }
    return options('How do you want to commit?', [
      { id: 'c', title: 'Commit staged changes', cmdline: 'git commit', detail: `${s?.staged.length ?? 0} file(s)`, run: message({}, 'Commit') },
      { id: 'a', title: 'Amend last commit', cmdline: 'git commit --amend', run: message({ amend: true }, 'Amend') },
      { id: 's', title: 'Commit with sign-off', cmdline: 'git commit --signoff', run: message({ signoff: true }, 'Sign-off') },
      { id: 'n', title: 'Commit without hooks', cmdline: 'git commit --no-verify', detail: 'skips pre-commit and commit-msg', run: message({ noVerify: true }, 'No hooks') }
    ])
  }

  const pushFlow = (): Step => {
    const branch = current?.name
    const upstream = current?.upstream
    const items = [
      upstream
        ? { id: 'p', title: `Push ${branch} to ${upstream}`, cmdline: 'git push', run: () => { d.exec(() => d.api.push({}), 'Pushed') } }
        : {
            id: 'p',
            title: `Push ${branch ?? 'HEAD'} and track ${remote}/${branch ?? ''}`,
            cmdline: `git push -u ${remote} ${branch ?? ''}`,
            run: () => { if (branch) d.exec(() => d.api.push({ remote, branch, setUpstream: true }), 'Pushed') }
          },
      ...d.remotes
        .filter((r) => r.name !== remote)
        .map((r) => ({ id: `r-${r.name}`, title: `Push ${branch} to ${r.name}`, cmdline: `git push ${r.name} ${branch}`, run: () => { if (branch) d.exec(() => d.api.push({ remote: r.name, branch }), `Pushed to ${r.name}`) } })),
      {
        id: 'f',
        title: 'Force push (with lease)',
        cmdline: 'git push --force-with-lease',
        detail: 'refuses if the remote has commits you have not fetched',
        run: () =>
          options('Really force push?', [
            { id: 'yes', title: `Yes, force push ${branch}`, cmdline: 'git push --force-with-lease', run: () => { d.exec(() => d.api.push(upstream ? { force: true } : { remote, branch, setUpstream: true, force: true }), 'Force pushed') } },
            { id: 'no', title: 'Cancel', cmdline: '', run: () => undefined }
          ])
      },
      { id: 'n', title: 'Push without hooks', cmdline: 'git push --no-verify', detail: 'skips pre-push', run: () => { d.exec(() => d.api.push(upstream ? { noVerify: true } : { remote, branch, setUpstream: true, noVerify: true }), 'Pushed') } },
      { id: 't', title: 'Push tags', cmdline: `git push ${remote} --tags`, run: () => { d.exec(() => d.api.push({ remote, tags: true }), 'Tags pushed') } }
    ]
    return options('Push', items)
  }

  const pullFlow = (): Step =>
    options('Pull', [
      { id: 'm', title: 'Pull (merge)', cmdline: 'git pull --no-rebase', run: () => { d.exec(() => d.api.pull({ mode: 'merge' }), 'Pulled') } },
      { id: 'r', title: 'Pull (rebase)', cmdline: 'git pull --rebase', run: () => { d.exec(() => d.api.pull({ mode: 'rebase' }), 'Pulled') } },
      { id: 'f', title: 'Pull (fast-forward only)', cmdline: 'git pull --ff-only', run: () => { d.exec(() => d.api.pull({ mode: 'ff-only' }), 'Pulled') } },
      ...(d.submodules.length
        ? [{ id: 's', title: 'Pull and update submodules', cmdline: 'git pull --recurse-submodules', run: () => { d.exec(() => d.api.pull({ recurseSubmodules: true }), 'Pulled') } }]
        : [])
    ])

  const fetchFlow = (): Step =>
    options('Fetch', [
      { id: 'a', title: 'Fetch all remotes', cmdline: 'git fetch --all --prune', run: () => { d.exec(() => d.api.fetch(), 'Fetched') } },
      ...d.remotes.map((r) => ({ id: `r-${r.name}`, title: `Fetch ${r.name}`, cmdline: `git fetch ${r.name} --prune`, detail: r.url, run: () => { d.exec(() => d.api.fetch({ remote: r.name }), `Fetched ${r.name}`) } })),
      { id: 't', title: 'Fetch all tags', cmdline: 'git fetch --all --tags', run: () => { d.exec(() => d.api.fetch({ tags: true }), 'Fetched tags') } },
      ...(d.submodules.length
        ? [{ id: 's', title: 'Fetch including submodules', cmdline: 'git fetch --all --recurse-submodules', run: () => { d.exec(() => d.api.fetch({ recurseSubmodules: true }), 'Fetched') } }]
        : [])
    ])

  const newBranchFlow = (startPoint?: string): Step => {
    const existing = new Set(d.branches.map((b) => b.name))
    return input(
      `New branch name (from ${startPoint?.slice(0, 8) ?? cur})`,
      (raw) => {
        const name = raw.trim().replace(/\s+/g, '-')
        if (existing.has(name)) {
          d.toast(`Branch ${name} already exists`, true)
          return
        }
        return options(`Create ${name}`, [
          { id: 'co', title: 'Create and check out', cmdline: `git checkout -b ${name}`, run: () => { d.exec(() => d.api.createBranch(name, startPoint, true)) } },
          { id: 'b', title: 'Create only', cmdline: `git branch ${name}`, run: () => { d.exec(() => d.api.createBranch(name, startPoint, false), `Created ${name}`) } }
        ])
      },
      { suggestions: BRANCH_PREFIXES, title: 'New Branch' }
    )
  }

  const mergeFlow = (): Step =>
    branchPicker(
      d,
      `Merge which branch into ${cur}?`,
      (b) =>
        options(`Merge ${b.name} into ${cur}`, [
          { id: 'm', title: 'Merge', cmdline: `git merge ${b.name}`, run: () => { d.exec(() => d.api.merge(b.name)) } },
          { id: 'nf', title: 'Merge, always create a merge commit', cmdline: `git merge --no-ff ${b.name}`, run: () => { d.exec(() => d.api.merge(b.name, { noFf: true })) } },
          { id: 'ff', title: 'Fast-forward only', cmdline: `git merge --ff-only ${b.name}`, run: () => { d.exec(() => d.api.merge(b.name, { ffOnly: true })) } },
          { id: 'sq', title: 'Squash into staged changes', cmdline: `git merge --squash ${b.name}`, run: () => { d.exec(() => d.api.merge(b.name, { squash: true })) } },
          { id: 'nv', title: 'Merge without hooks', cmdline: `git merge --no-verify ${b.name}`, run: () => { d.exec(() => d.api.merge(b.name, { noVerify: true })) } }
        ]),
      { excludeCurrent: true }
    )

  const rebaseFlow = (): Step =>
    branchPicker(
      d,
      `Rebase ${cur} onto which branch?`,
      (b) =>
        options(`Rebase ${cur} onto ${b.name}`, [
          { id: 'r', title: 'Rebase', cmdline: `git rebase ${b.name}`, run: () => { d.exec(() => d.api.rebase(b.name)) } },
          { id: 'a', title: 'Rebase, stashing local changes around it', cmdline: `git rebase --autostash ${b.name}`, run: () => { d.exec(() => d.api.rebase(b.name, true)) } }
        ]),
      { excludeCurrent: true }
    )

  const stashFlow = (): Step => {
    const message = (opts: { includeUntracked: boolean; keepIndex?: boolean }) => (): Step =>
      input('Stash message', (m) => { d.exec(() => d.api.stash({ ...opts, message: m || undefined }), 'Stashed') }, { value: `WIP on ${cur}`, allowEmpty: true, title: 'Message' })
    return options('What to stash?', [
      { id: 'all', title: 'Everything, including untracked files', cmdline: 'git stash push -u', run: message({ includeUntracked: true }) },
      { id: 'tracked', title: 'Tracked changes only', cmdline: 'git stash push', run: message({ includeUntracked: false }) },
      { id: 'keep', title: 'Everything, but keep staged changes in place', cmdline: 'git stash push -u --keep-index', run: message({ includeUntracked: true, keepIndex: true }) }
    ])
  }

  const stashManageFlow = (): Step =>
    list(
      'Which stash?',
      d.stashes.map((x) => ({
        id: x.ref,
        title: x.message,
        detail: x.ref,
        run: () =>
          options(x.ref, [
            { id: 'pop', title: 'Pop (apply and remove)', cmdline: `git stash pop ${x.ref}`, run: () => { d.exec(() => d.api.stashApply(x.ref, true)) } },
            { id: 'apply', title: 'Apply (keep stash)', cmdline: `git stash apply ${x.ref}`, run: () => { d.exec(() => d.api.stashApply(x.ref, false)) } },
            { id: 'drop', title: 'Drop (delete stash)', cmdline: `git stash drop ${x.ref}`, run: () => { d.exec(() => d.api.stashDrop(x.ref)) } }
          ])
      })),
      'Stashes'
    )

  const tagFlow = (sha = 'HEAD'): Step =>
    input(
      `Tag name for ${sha === 'HEAD' ? 'HEAD' : sha.slice(0, 8)}`,
      (name) =>
        options(`Create ${name}`, [
          { id: 'l', title: 'Lightweight tag', cmdline: `git tag ${name}`, run: () => { d.exec(() => d.api.createTag(name, sha), `Tagged ${name}`) } },
          {
            id: 'a',
            title: 'Annotated tag, with a message',
            cmdline: `git tag -a ${name} -m …`,
            run: () => input('Tag message', (m) => { d.exec(() => d.api.createTag(name, sha, m), `Tagged ${name}`) }, { value: name, title: 'Message' })
          }
        ]),
      { suggestions: nextVersions(d.tags), title: 'Tag' }
    )

  const deleteBranchFlow = (): Step =>
    branchPicker(
      d,
      'Delete which branch?',
      (b) =>
        options(`Delete ${b.name}`, [
          { id: 'd', title: 'Delete (only if merged)', cmdline: `git branch -d ${b.name}`, run: () => { d.exec(() => d.api.deleteBranch(b.name, false), `Deleted ${b.name}`) } },
          { id: 'D', title: 'Force delete (even if not merged)', cmdline: `git branch -D ${b.name}`, run: () => { d.exec(() => d.api.deleteBranch(b.name, true), `Deleted ${b.name}`) } }
        ]),
      { remote: false, excludeCurrent: true }
    )

  const submoduleUpdateFlow = (): Step => {
    const variants = (paths: string[], label: string) =>
      options(label, [
        { id: 'rec', title: 'Update to the recorded commit', cmdline: `git submodule update --init --recursive${paths.length ? ` -- ${paths[0]}` : ''}`, run: () => { d.exec(() => d.api.submoduleUpdate(paths, { init: true }), 'Submodules updated') } },
        { id: 'rem', title: 'Update to the latest remote commit', cmdline: `git submodule update --init --recursive --remote${paths.length ? ` -- ${paths[0]}` : ''}`, run: () => { d.exec(() => d.api.submoduleUpdate(paths, { init: true, remote: true }), 'Submodules updated') } }
      ])
    return list(
      'Which submodule?',
      [
        { id: '*', title: 'All submodules', detail: `${d.submodules.length}`, run: () => variants([], 'All submodules') },
        ...d.submodules.map((m) => ({ id: m.path, title: m.path, detail: m.state, run: () => variants([m.path], m.path) }))
      ],
      'Update'
    )
  }

  const submoduleAddFlow = (): Step =>
    input(
      'Repository URL or local path',
      (url) => {
        const name = repoName(url)
        return input(
          'Path inside this repository',
          (path) => { d.exec(() => d.api.submoduleAdd(url, path), `Added submodule ${path}`) },
          { value: name, title: name, suggestions: [{ value: name }, { value: `vendor/${name}` }, { value: `libs/${name}` }, { value: `external/${name}` }] }
        )
      },
      { title: 'Add Submodule' }
    )

  const openSubmodule = async (m: Submodule) => d.openRepo(await d.api.submodulePath(m.path))

  // ---------------------------------------------------------------- table

  return [
    // repository
    { id: 'repo.open', title: 'Repository: Open…', run: () => { d.api.pickRepo().then((dir) => { if (dir) d.openRepo(dir) }) } },
    { id: 'repo.recent', title: 'Repository: Open Recent…', run: () => recentPicker(d) },
    { id: 'repo.clone', title: 'Repository: Clone…', run: () => input('Repository URL to clone', (url) => { d.api.cloneRepo(url).then((r) => r && d.openRepo(r.path)).catch((e) => d.toast(e.message, true)) }, { title: 'Clone' }) },
    { id: 'repo.init', title: 'Repository: New (git init)…', run: () => { d.api.initRepo().then((r) => r && d.openRepo(r.path)).catch((e) => d.toast(e.message, true)) } },
    { id: 'repo.parent', title: 'Repository: Open Parent (superproject)', when: !!d.superproject, run: () => d.openRepo(d.superproject!) },
    { id: 'repo.identity', title: 'Repository: Set Author Identity…', detail: 'user.name and user.email', when: has, run: async () => { const cur = await d.api.identity(); return { ...identityFlow(d), value: cur.name } as Step } },
    { id: 'repo.reveal', title: 'Repository: Show in File Manager', when: has, run: () => { d.api.openExternal(d.repo!.path) } },
    { id: 'repo.close', title: 'Repository: Close', when: has, run: () => d.closeRepo() },

    // commit
    { id: 'commit', title: 'Commit…', detail: 'commit, amend, sign-off, no hooks', when: has, run: commitFlow },
    { id: 'commit.focus', title: 'Commit: Write Message in Editor', detail: 'multi-line message', when: has, run: () => d.commitAction('focus') },
    { id: 'commit.commit', title: 'Commit: Commit Staged Now', when: has && !!s?.staged.length, run: () => d.commitAction('commit') },
    { id: 'commit.noverify', title: 'Commit: Commit Without Hooks', cmdline: 'git commit --no-verify', when: has && !!s?.staged.length, run: () => d.commitAction('commit-no-verify') },
    {
      id: 'commit.undo',
      title: 'Commit: Undo Last Commit (keep changes)',
      cmdline: 'git reset --soft HEAD~1',
      when: has && d.commits.length > 1,
      run: () => { d.exec(() => d.api.reset('HEAD~1', 'soft'), 'Last commit undone, changes kept staged') }
    },
    { id: 'stage.all', title: 'Stage: Stage All', cmdline: 'git add -A', when: has && !!s?.unstaged.length, run: () => { d.mutate(() => d.api.stageAll()) } },
    { id: 'stage.none', title: 'Stage: Unstage All', cmdline: 'git reset', when: has && !!s?.staged.length, run: () => { d.mutate(() => d.api.unstageAll()) } },
    {
      id: 'stage.discard',
      title: 'Stage: Discard All Unstaged Changes…',
      when: has && !!s?.unstaged.length,
      run: () =>
        options('Discard all unstaged changes? This cannot be undone.', [
          {
            id: 'yes',
            title: 'Yes, discard everything unstaged',
            cmdline: 'git restore . && git clean -f',
            run: () => { if (s) d.mutate(() => d.api.discard(s.unstaged.filter((f) => f.status !== '?').map((f) => f.path), s.unstaged.filter((f) => f.status === '?').map((f) => f.path))) }
          },
          { id: 'no', title: 'Cancel', cmdline: '', run: () => undefined }
        ])
    },

    // remote
    { id: 'remote.fetch', title: 'Remote: Fetch…', when: has, run: fetchFlow },
    { id: 'remote.pull', title: 'Remote: Pull…', when: has, run: pullFlow },
    { id: 'remote.push', title: 'Remote: Push…', when: has, run: pushFlow },

    // branch
    { id: 'branch.checkout', title: 'Branch: Checkout…', when: has, run: () => branchPicker(d, 'Checkout which branch?', (b) => { d.exec(() => (b.remote ? d.api.checkoutRemote(b.name) : d.api.checkout(b.name))) }, { excludeCurrent: true, cmd: (b) => (b.remote ? `git checkout --track ${b.name}` : `git checkout ${b.name}`) }) },
    { id: 'branch.new', title: 'Branch: New Branch…', when: has, run: () => newBranchFlow() },
    { id: 'branch.merge', title: `Branch: Merge Into ${cur}…`, when: has && !op, run: mergeFlow },
    { id: 'branch.rebase', title: `Branch: Rebase ${cur} Onto…`, when: has && !op, run: rebaseFlow },
    { id: 'branch.delete', title: 'Branch: Delete…', when: has, run: deleteBranchFlow },
    { id: 'branch.goto', title: 'Go to: Branch…', when: has, run: () => branchPicker(d, 'Show which branch?', (b) => d.select(b.sha)) },
    {
      id: 'goto.commit',
      title: 'Go to: Commit…',
      detail: 'search history by message, author or sha',
      when: has && d.commits.length > 0,
      run: () => list('Find commit', d.commits.slice(0, 5000).map((c) => ({ id: c.sha, title: c.subject, detail: `${c.sha.slice(0, 8)}  ${c.author}`, run: () => d.select(c.sha) })))
    },
    { id: 'goto.working', title: 'Go to: Working Directory', when: has, run: () => d.select('working') },

    // tags & stash
    { id: 'tag.create', title: 'Tag: Create at HEAD…', when: has, run: () => tagFlow() },
    {
      id: 'tag.delete',
      title: 'Tag: Delete…',
      when: has && d.tags.length > 0,
      run: () => list('Delete which tag?', d.tags.map((t) => ({ id: t.name, title: t.name, cmdline: `git tag -d ${t.name}`, run: () => { d.exec(() => d.api.deleteTag(t.name), `Deleted ${t.name}`) } })))
    },
    { id: 'stash.push', title: 'Stash: Stash Changes…', when: has && dirty, run: stashFlow },
    { id: 'stash.pop', title: 'Stash: Pop Latest', cmdline: 'git stash pop', when: has && d.stashes.length > 0, run: () => { d.exec(() => d.api.stashApply(d.stashes[0].ref, true)) } },
    { id: 'stash.manage', title: 'Stash: Apply / Pop / Drop…', when: has && d.stashes.length > 0, run: stashManageFlow },

    // operations
    { id: 'op.continue', title: `Operation: Continue ${op ?? ''}`, when: has && !!op, run: () => { d.exec(() => d.api.continueOperation(op!)) } },
    { id: 'op.abort', title: `Operation: Abort ${op ?? ''}`, when: has && !!op, run: () => { d.exec(() => d.api.abortOperation(op!)) } },

    // submodules
    { id: 'sub.open', title: 'Submodule: Open…', when: initialized.length > 0, run: () => list('Open which submodule?', initialized.map((m) => ({ id: m.path, title: m.path, detail: m.describe ?? m.sha.slice(0, 8), run: () => { openSubmodule(m) } })), 'Open') },
    { id: 'sub.update', title: 'Submodule: Update…', when: d.submodules.length > 0, run: submoduleUpdateFlow },
    { id: 'sub.add', title: 'Submodule: Add…', when: has, run: submoduleAddFlow },
    { id: 'sub.sync', title: 'Submodule: Sync URLs', cmdline: 'git submodule sync --recursive', when: d.submodules.length > 0, run: () => { d.exec(() => d.api.submoduleSync(), 'Submodule URLs synced') } },
    {
      id: 'sub.deinit',
      title: 'Submodule: Deinitialize…',
      when: initialized.length > 0,
      run: () =>
        list(
          'Deinitialize which submodule?',
          initialized.map((m) => ({
            id: m.path,
            title: m.path,
            run: () =>
              options(`Deinitialize ${m.path}? Local changes inside it are lost.`, [
                { id: 'yes', title: 'Yes, deinitialize', cmdline: `git submodule deinit -f -- ${m.path}`, run: () => { d.exec(() => d.api.submoduleDeinit(m.path)) } },
                { id: 'no', title: 'Cancel', cmdline: '', run: () => undefined }
              ])
          })),
          'Deinit'
        )
    },

    // hooks
    { id: 'hooks.show', title: 'Hooks: Show Hooks', when: has, run: () => d.showHooks() },
    {
      id: 'hooks.run',
      title: 'Hooks: Run Hook Now…',
      detail: 'test a hook without committing',
      when: has && !!d.hooks?.hooks.some((h) => h.enabled),
      run: () => list('Run which hook?', d.hooks!.hooks.filter((h) => h.enabled).map((h) => ({ id: h.name, title: h.name, cmdline: `git hook run ${h.name}`, run: () => { d.exec(() => d.api.runHook(h.name, ''), `${h.name} passed`) } })))
    },
    {
      id: 'hooks.toggle',
      title: 'Hooks: Enable / Disable Hook…',
      when: has && !!d.hooks?.hooks.some((h) => h.exists),
      run: () =>
        list(
          'Toggle which hook?',
          d.hooks!.hooks.filter((h) => h.exists).map((h) => ({
            id: h.name,
            title: h.name,
            detail: h.enabled ? 'enabled, select to disable' : 'disabled, select to enable',
            run: () => { d.mutate(() => d.api.setHookEnabled(h.name, !h.enabled)).then((ok) => ok && d.toast(`${h.name} ${h.enabled ? 'disabled' : 'enabled'}`)) }
          }))
        )
    },
    {
      id: 'hooks.edit',
      title: 'Hooks: Edit Hook…',
      when: has && !!d.hooks,
      run: () => list('Edit which hook?', (d.hooks?.hooks ?? []).map((h) => ({ id: h.name, title: h.name, detail: h.exists ? (h.enabled ? 'active' : 'disabled') : 'not installed', run: () => d.showHooks(h.name) })))
    },

    // view
    { id: 'view.console', title: 'View: Toggle Hook Console', run: () => d.toggleConsole() },
    { id: 'view.sidebar', title: 'View: Toggle Sidebar', when: has, run: () => d.toggleSidebar() },
    { id: 'view.theme', title: 'View: Toggle Paper / Chalkboard Theme', run: () => d.toggleTheme() },
    { id: 'view.refresh', title: 'View: Refresh', when: has, run: () => d.refresh() },
    { id: 'view.find', title: 'Find: Search Commits', detail: 'message, author, sha', when: has, run: () => d.find() },
    { id: 'view.history', title: 'View: Command History', detail: 'every command run in this repository', when: has, run: () => d.showHistory() },
    { id: 'app.settings', title: 'Preferences: Settings', detail: 'hook environment, PATH, timeout, diagnostics', run: () => d.openSettings() }
  ]
}

export { newBranchFlowFor, tagFlowFor }

/** Palette flows reused by context menus (branch / tag at a specific commit). */
function newBranchFlowFor(d: CommandDeps, sha: string): Step {
  const existing = new Set(d.branches.map((b) => b.name))
  return input(
    `New branch at ${sha.slice(0, 8)}`,
    (raw) => {
      const name = raw.trim().replace(/\s+/g, '-')
      if (existing.has(name)) return void d.toast(`Branch ${name} already exists`, true)
      return options(`Create ${name}`, [
        { id: 'co', title: 'Create and check out', cmdline: `git checkout -b ${name} ${sha.slice(0, 8)}`, run: () => { d.exec(() => d.api.createBranch(name, sha, true)) } },
        { id: 'b', title: 'Create only', cmdline: `git branch ${name} ${sha.slice(0, 8)}`, run: () => { d.exec(() => d.api.createBranch(name, sha, false), `Created ${name}`) } }
      ])
    },
    { suggestions: BRANCH_PREFIXES, title: 'New Branch' }
  )
}

function tagFlowFor(d: CommandDeps, sha: string): Step {
  return input(
    `Tag name for ${sha.slice(0, 8)}`,
    (name) =>
      options(`Create ${name}`, [
        { id: 'l', title: 'Lightweight tag', cmdline: `git tag ${name} ${sha.slice(0, 8)}`, run: () => { d.exec(() => d.api.createTag(name, sha), `Tagged ${name}`) } },
        { id: 'a', title: 'Annotated tag, with a message', cmdline: `git tag -a ${name} -m …`, run: () => input('Tag message', (m) => { d.exec(() => d.api.createTag(name, sha, m), `Tagged ${name}`) }, { value: name, title: 'Message' }) }
      ]),
    { suggestions: nextVersions(d.tags), title: 'Tag' }
  )
}
