import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { SearchQuery } from '@shared/search'
import type {
  Branch,
  CommandResult,
  Commit,
  CommitDetail,
  CommitOptions,
  FetchOptions,
  FileDiff,
  LogOptions,
  MergeOptions,
  PullOptions,
  StashOptions,
  Submodule,
  GraphRow,
  PushOptions,
  Remote,
  Stash,
  Tag,
  WorkingStatus
} from '@shared/types'
import { GitRunner } from './runner'
import {
  BRANCH_FORMAT,
  LOG_FORMAT,
  buildPatch,
  layoutGraph,
  parseBranches,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseStatus
} from './parsers'

export type DiffSource =
  | { kind: 'unstaged'; path: string; untracked?: boolean }
  | { kind: 'staged'; path: string }
  | { kind: 'commit'; sha: string; path: string }

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export class GitRepo {
  constructor(
    public readonly root: string,
    private readonly git: GitRunner
  ) {}

  static async resolveRoot(git: GitRunner, dir: string): Promise<string> {
    const out = await git.data(dir, ['rev-parse', '--show-toplevel'])
    return out.trim()
  }

  private data(args: string[], opts?: { input?: string; allowExit?: number[] }): Promise<string> {
    return this.git.data(this.root, args, opts)
  }

  private run(title: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
    return this.git.run(this.root, args, { title, input, env, queueKey: this.root })
  }

  /** Index-changing writes: silent, but queued behind any running command. */
  private write(args: string[], opts?: { input?: string; allowExit?: number[] }): Promise<string> {
    return this.git.mutate(this.root, args, opts)
  }

  /** Reads HEAD straight from disk: no process spawn. */
  async hasHead(): Promise<boolean> {
    return readSubmoduleHead(this.root) !== null
  }

  private gitDirCache: string | null = null
  async gitDir(): Promise<string> {
    this.gitDirCache ??= (await this.data(['rev-parse', '--absolute-git-dir'])).trim()
    return this.gitDirCache
  }

  // ---------------------------------------------------------------- read

  async status(): Promise<WorkingStatus> {
    const out = await this.data(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
    const parsed = parseStatus(out)
    const gd = await this.gitDir()
    let operation: string | null = null
    if (existsSync(join(gd, 'rebase-merge')) || existsSync(join(gd, 'rebase-apply'))) operation = 'rebasing'
    else if (existsSync(join(gd, 'MERGE_HEAD'))) operation = 'merging'
    else if (existsSync(join(gd, 'CHERRY_PICK_HEAD'))) operation = 'cherry-picking'
    else if (existsSync(join(gd, 'REVERT_HEAD'))) operation = 'reverting'
    return { ...parsed, operation }
  }

  private logCache: { key: string; commits: Commit[]; graph: GraphRow[] } | null = null

  /**
   * Cheap fingerprint of every ref + HEAD + view options. The full log and graph layout are
   * only recomputed (and only sent over IPC) when this changes.
   */
  private async refsKey(limit: number, opts: LogOptions): Promise<string> {
    const [refs, head] = await Promise.all([
      this.data(['for-each-ref', '--format=%(objectname) %(refname)']),
      this.data(['rev-parse', '-q', '--verify', 'HEAD'], { allowExit: [1] })
    ])
    return `${limit}\n${head.trim()}\n${JSON.stringify(opts)}\n${refs}`
  }

  async log(
    limit = 3000,
    knownKey?: string,
    opts: LogOptions = {}
  ): Promise<{ key: string; unchanged?: boolean; commits: Commit[]; graph: GraphRow[] }> {
    const key = await this.refsKey(limit, opts)
    if (knownKey === key) return { key, unchanged: true, commits: [], graph: [] }
    if (this.logCache?.key === key) return this.logCache
    const head = key.split('\n')[1]
    const hasRefs = key.split('\n').slice(3).join('').trim() !== ''
    if (!head && !hasRefs) return { key, commits: [], graph: [] }
    // Hidden branches: --exclude applies to the --branches / --remotes that follows it, with
    // patterns relative to refs/heads/ and refs/remotes/.
    const hidden = opts.hidden ?? []
    const exLocal = hidden.filter((r) => r.startsWith('refs/heads/')).map((r) => `--exclude=${r.slice(11)}`)
    const exRemote = hidden.filter((r) => r.startsWith('refs/remotes/')).map((r) => `--exclude=${r.slice(13)}`)
    const revs = opts.only
      ? [opts.only]
      : [...exLocal, '--branches', ...exRemote, '--remotes', '--tags', ...(head ? ['HEAD'] : [])]
    const [out, remotes] = await Promise.all([
      this.data(['log', ...revs, '--topo-order', `--max-count=${limit}`, `--format=${LOG_FORMAT}`, '--']),
      this.remotes()
    ])
    const remoteNames = remotes.map((r) => r.name + '/')
    const commits = parseLog(out)
    for (const c of commits) {
      for (const r of c.refs) {
        if (r.type === 'remote' && !remoteNames.some((n) => r.name.startsWith(n))) r.type = 'branch'
      }
    }
    this.logCache = { key, commits, graph: layoutGraph(commits) }
    return this.logCache
  }

  async commitDetail(sha: string): Promise<CommitDetail> {
    const fmt = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D', '%cn', '%ct', '%B'].join('%x1f')
    const out = await this.data(['show', '-s', `--format=${fmt}`, sha])
    const [h, parents, author, email, date, subject, , committer, cdate, ...body] = out.split('\x1f')
    const parentList = parents ? parents.split(' ') : []
    const base = parentList[0] ?? EMPTY_TREE
    const files = parseNameStatus(await this.data(['diff', '--name-status', '-z', '-M', base, h]))
    const logEntry = parseLog(
      await this.data(['log', '-1', `--format=${LOG_FORMAT}`, h])
    )[0]
    return {
      sha: h,
      parents: parentList,
      author,
      email,
      date: Number(date) * 1000,
      subject,
      refs: logEntry?.refs ?? [],
      committer,
      committerDate: Number(cdate) * 1000,
      body: body.join('\x1f').replace(/\n+$/, ''),
      files
    }
  }

  async diff(src: DiffSource, context = 3): Promise<FileDiff | null> {
    const u = `-U${context}`
    let out: string
    if (src.kind === 'unstaged' && src.untracked) {
      out = await this.data(['diff', '--no-index', u, '--', '/dev/null', src.path], { allowExit: [1] })
    } else if (src.kind === 'unstaged') {
      out = await this.data(['diff', u, '--', src.path])
    } else if (src.kind === 'staged') {
      const base = (await this.hasHead()) ? [] : [EMPTY_TREE]
      out = await this.data(['diff', '--cached', u, ...base, '--', src.path])
    } else {
      const detail = await this.data(['rev-list', '--parents', '-n', '1', src.sha])
      const parent = detail.trim().split(' ')[1] ?? EMPTY_TREE
      out = await this.data(['diff', u, '-M', parent, src.sha, '--', src.path])
    }
    const files = parseDiff(out)
    return files[0] ?? null
  }

  async branches(): Promise<Branch[]> {
    return parseBranches(await this.data(['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes']))
  }

  async tags(): Promise<Tag[]> {
    const out = await this.data([
      'for-each-ref',
      '--sort=-creatordate',
      '--format=%(refname:short)%1f%(objectname)%1f%(*objectname)',
      'refs/tags'
    ])
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, sha, peeled] = l.split('\x1f')
        return { name, sha: peeled || sha }
      })
  }

  async stashes(): Promise<Stash[]> {
    const out = await this.data(['stash', 'list', '--format=%gd%x1f%s'])
    return out
      .split('\n')
      .filter(Boolean)
      .map((l, index) => {
        const [ref, message] = l.split('\x1f')
        return { index, ref, message }
      })
  }

  async remotes(): Promise<Remote[]> {
    const out = await this.data(['remote', '-v'])
    const seen = new Map<string, string>()
    for (const line of out.split('\n')) {
      const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
      if (m) seen.set(m[1], m[2])
    }
    return [...seen].map(([name, url]) => ({ name, url }))
  }

  async lastCommitMessage(): Promise<string> {
    if (!(await this.hasHead())) return ''
    return (await this.data(['log', '-1', '--format=%B'])).replace(/\n+$/, '')
  }

  // ---------------------------------------------------------------- index

  async stage(paths: string[]): Promise<void> {
    if (paths.length) await this.write(['add', '-A', '--', ...paths])
  }

  async stageAll(): Promise<void> {
    await this.write(['add', '-A'])
  }

  async unstage(paths: string[]): Promise<void> {
    if (!paths.length) return
    if (await this.hasHead()) await this.write(['restore', '--staged', '--', ...paths])
    else await this.write(['rm', '--cached', '-r', '-q', '--', ...paths])
  }

  async unstageAll(): Promise<void> {
    if (await this.hasHead()) await this.write(['reset', '-q'])
    else await this.write(['rm', '--cached', '-r', '-q', '.'])
  }

  async discard(paths: string[], untracked: string[]): Promise<void> {
    if (paths.length) await this.write(['restore', '--worktree', '--', ...paths])
    if (untracked.length) await this.write(['clean', '-f', '-q', '--', ...untracked])
  }

  /**
   * Stage / unstage / discard a hunk (or selected lines of it).
   * mode "stage": diff comes from unstaged, applied to index.
   * mode "unstage": diff comes from staged, reverse-applied to index.
   * mode "discard": diff comes from unstaged, reverse-applied to worktree.
   */
  async applyHunk(
    file: FileDiff,
    hunkIndex: number,
    lines: number[] | null,
    mode: 'stage' | 'unstage' | 'discard'
  ): Promise<void> {
    const reverse = mode !== 'stage'
    const patch = buildPatch(file, hunkIndex, lines, reverse)
    const args = ['apply', '--recount', '--whitespace=nowarn']
    if (mode !== 'discard') args.push('--cached')
    if (reverse) args.push('--reverse')
    args.push('-')
    await this.write(args, { input: patch })
  }

  // ---------------------------------------------------------------- write (hook-aware)

  async commit(opts: CommitOptions): Promise<CommandResult> {
    // Pass the message through a file (not -m) so commit-msg / prepare-commit-msg hooks see
    // exactly what a terminal user would, including multi-line bodies and comments.
    const dir = mkdtempSync(join(tmpdir(), 'odysseus-msg-'))
    const msgFile = join(dir, 'COMMIT_EDITMSG')
    writeFileSync(msgFile, opts.message.endsWith('\n') ? opts.message : opts.message + '\n')
    const args = ['commit', '-F', msgFile, '--cleanup=strip']
    if (opts.amend) args.push('--amend')
    if (opts.noVerify) args.push('--no-verify')
    if (opts.signoff) args.push('--signoff')
    try {
      return await this.run(opts.amend ? 'Amend commit' : 'Commit', args)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  checkout(ref: string): Promise<CommandResult> {
    return this.run(`Checkout ${ref}`, ['checkout', ref])
  }

  checkoutRemote(remoteBranch: string): Promise<CommandResult> {
    const local = remoteBranch.split('/').slice(1).join('/')
    return this.run(`Checkout ${local}`, ['checkout', '-b', local, '--track', remoteBranch])
  }

  createBranch(name: string, startPoint?: string, checkout = true): Promise<CommandResult> {
    const args = checkout ? ['checkout', '-b', name] : ['branch', name]
    if (startPoint) args.push(startPoint)
    return this.run(`Create branch ${name}`, args)
  }

  deleteBranch(name: string, force = false): Promise<CommandResult> {
    return this.run(`Delete branch ${name}`, ['branch', force ? '-D' : '-d', name])
  }

  merge(ref: string, opts: MergeOptions | boolean = {}): Promise<CommandResult> {
    const o: MergeOptions = typeof opts === 'boolean' ? { noVerify: opts } : opts
    const args = ['merge', '--no-edit']
    if (o.noFf) args.push('--no-ff')
    if (o.ffOnly) args.push('--ff-only')
    if (o.squash) args.push('--squash')
    if (o.noVerify) args.push('--no-verify')
    args.push(ref)
    return this.run(`Merge ${ref}`, args)
  }

  rebase(onto: string, autostash = false): Promise<CommandResult> {
    return this.run(`Rebase onto ${onto}`, ['rebase', ...(autostash ? ['--autostash'] : []), onto])
  }

  abortOperation(op: string): Promise<CommandResult> {
    const cmd = op === 'rebasing' ? 'rebase' : op === 'merging' ? 'merge' : op === 'reverting' ? 'revert' : 'cherry-pick'
    return this.run(`Abort ${cmd}`, [cmd, '--abort'])
  }

  continueOperation(op: string): Promise<CommandResult> {
    const cmd = op === 'rebasing' ? 'rebase' : op === 'merging' ? 'merge' : op === 'reverting' ? 'revert' : 'cherry-pick'
    return this.run(`Continue ${cmd}`, [cmd, '--continue'])
  }

  cherryPick(sha: string): Promise<CommandResult> {
    return this.run(`Cherry-pick ${sha.slice(0, 7)}`, ['cherry-pick', sha])
  }

  revert(sha: string): Promise<CommandResult> {
    return this.run(`Revert ${sha.slice(0, 7)}`, ['revert', '--no-edit', sha])
  }

  reset(sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<CommandResult> {
    return this.run(`Reset (${mode}) to ${sha.slice(0, 7)}`, ['reset', `--${mode}`, sha])
  }

  createTag(name: string, sha: string, message?: string): Promise<CommandResult> {
    const args = message ? ['tag', '-a', name, '-m', message, sha] : ['tag', name, sha]
    return this.run(`Create tag ${name}`, args)
  }

  deleteTag(name: string): Promise<CommandResult> {
    return this.run(`Delete tag ${name}`, ['tag', '-d', name])
  }

  fetch(opts: FetchOptions = {}): Promise<CommandResult> {
    const args = ['fetch', '--prune', '--progress']
    if (opts.tags) args.push('--tags')
    if (opts.recurseSubmodules) args.push('--recurse-submodules')
    args.push(...(opts.remote ? [opts.remote] : ['--all']))
    return this.run(opts.remote ? `Fetch ${opts.remote}` : 'Fetch', args)
  }

  pull(opts: PullOptions | boolean = {}): Promise<CommandResult> {
    const o: PullOptions = typeof opts === 'boolean' ? { mode: opts ? 'rebase' : 'merge' } : opts
    const mode = o.mode ?? 'merge'
    const args = ['pull', '--progress', mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase']
    if (o.recurseSubmodules) args.push('--recurse-submodules')
    return this.run('Pull', args)
  }

  push(opts: PushOptions): Promise<CommandResult> {
    const args = ['push', '--progress']
    if (opts.force) args.push('--force-with-lease')
    if (opts.noVerify) args.push('--no-verify')
    if (opts.setUpstream) args.push('-u')
    if (opts.tags) args.push('--tags')
    if (opts.remote) args.push(opts.remote)
    if (opts.branch) args.push(opts.branch)
    return this.run('Push', args)
  }

  stash(opts: StashOptions | string = {}): Promise<CommandResult> {
    const o: StashOptions = typeof opts === 'string' ? { message: opts } : opts
    const args = ['stash', 'push']
    if (o.includeUntracked ?? true) args.push('-u')
    if (o.keepIndex) args.push('--keep-index')
    if (o.message) args.push('-m', o.message)
    return this.run('Stash', args)
  }

  // ---------------------------------------------------------------- identity

  async identity(): Promise<{ name: string; email: string }> {
    const get = (k: string) => this.data(['config', '--get', k], { allowExit: [1] }).then((v) => v.trim())
    const [name, email] = await Promise.all([get('user.name'), get('user.email')])
    return { name, email }
  }

  async setIdentity(name: string, email: string, global: boolean): Promise<void> {
    const scope = global ? ['--global'] : []
    await this.data(['config', ...scope, 'user.name', name])
    await this.data(['config', ...scope, 'user.email', email])
  }

  // ---------------------------------------------------------------- branch management

  renameBranch(from: string, to: string): Promise<CommandResult> {
    return this.run(`Rename ${from} to ${to}`, ['branch', '-m', from, to])
  }

  setUpstream(branch: string, upstream: string): Promise<CommandResult> {
    return this.run(`Set upstream of ${branch}`, ['branch', `--set-upstream-to=${upstream}`, branch])
  }

  unsetUpstream(branch: string): Promise<CommandResult> {
    return this.run(`Unset upstream of ${branch}`, ['branch', '--unset-upstream', branch])
  }

  async deleteRemoteBranch(remoteRef: string): Promise<CommandResult> {
    const remotes = (await this.remotes()).map((r) => r.name).sort((a, b) => b.length - a.length)
    const remote = remotes.find((r) => remoteRef.startsWith(r + '/')) ?? remoteRef.split('/')[0]
    const branch = remoteRef.slice(remote.length + 1)
    return this.run(`Delete ${remoteRef}`, ['push', remote, '--delete', branch])
  }

  /**
   * Runs a structured search on git itself (not just the loaded commits), so it reaches the
   * whole history. Bare words must all appear in the message; a hex word also matches a hash.
   */
  async search(q: SearchQuery, limit = 10000): Promise<Commit[]> {
    limit = q.limit ?? limit
    const head = readSubmoduleHead(this.root)
    const revs = q.branch ? [q.branch] : ['--branches', '--remotes', '--tags', ...(head ? ['HEAD'] : [])]
    const args = ['log', ...revs, '--topo-order', `--max-count=${limit}`, `--format=${LOG_FORMAT}`, '-i']
    if (q.author) {
      // author:me searches your own commits by configured email
      const me = q.author.toLowerCase() === 'me' ? (await this.identity()).email : ''
      args.push(`--author=${me || q.author}`)
    }
    if (q.firstParent) args.push('--first-parent')
    if (q.string) args.push(`-S${q.string}`)
    if (q.committer) args.push(`--committer=${q.committer}`)
    if (q.after) args.push(`--after=${q.after}`)
    if (q.before) args.push(`--before=${q.before}`)
    if (q.maxParents !== undefined) args.push(`--max-parents=${q.maxParents}`)
    if (q.minParents !== undefined) args.push(`--min-parents=${q.minParents}`)
    if (q.contents) args.push(`-G${q.contents}`)
    // Plain words are matched literally; regex: terms as extended regular expressions.
    const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const words = [...q.message, ...q.text].map(escape).concat(q.regex ?? [])
    for (const w of words) args.push(`--grep=${w}`)
    if (words.length) args.push('--extended-regexp')
    if (words.length > 1) args.push('--all-match')
    args.push('--', ...q.paths)

    const byMessage = parseLog(await this.data(args).catch(() => ''))
    // A lone hex word may be a commit hash rather than message text.
    const hashes = q.text.filter((t) => /^[0-9a-f]{4,40}$/i.test(t))
    if (!hashes.length) return byMessage
    const found: Commit[] = []
    for (const h of hashes) {
      const out = await this.data(['log', '-1', `--format=${LOG_FORMAT}`, `${h}^{commit}`, '--']).catch(() => '')
      found.push(...parseLog(out))
    }
    const seen = new Set(found.map((c) => c.sha))
    return [...found, ...byMessage.filter((c) => !seen.has(c.sha))]
  }

  /** Commits reachable from one ref, for "Search…" on a branch. */
  async logRef(ref: string, limit = 3000): Promise<Commit[]> {
    return parseLog(await this.data(['log', ref, '--topo-order', `--max-count=${limit}`, `--format=${LOG_FORMAT}`, '--']))
  }

  // ---------------------------------------------------------------- history editing

  /**
   * Runs a non-interactive `git rebase -i`: a tiny script rewrites the todo list (reword / drop
   * one commit) and another supplies the new message, so hooks (pre-rebase, post-rewrite)
   * still run exactly as they would in a terminal.
   */
  private async scriptedRebase(sha: string, action: 'reword' | 'drop', message?: string): Promise<CommandResult> {
    const dir = mkdtempSync(join(tmpdir(), 'odysseus-rebase-'))
    const seq = join(dir, 'seq.js')
    const ed = join(dir, 'msg.js')
    const msgFile = join(dir, 'message.txt')
    writeFileSync(
      seq,
      `const fs=require('fs');const f=process.argv[process.argv.length-1];const sha=${JSON.stringify(sha)};
let done=false;const out=fs.readFileSync(f,'utf8').split('\\n').map(l=>{const m=l.match(/^pick ([0-9a-f]+)(.*)$/);
if(!done&&m&&sha.startsWith(m[1])){done=true;return '${action} '+m[1]+m[2]}return l});fs.writeFileSync(f,out.join('\\n'))`
    )
    writeFileSync(ed, `const fs=require('fs');fs.writeFileSync(process.argv[process.argv.length-1],fs.readFileSync(${JSON.stringify(msgFile)},'utf8'))`)
    writeFileSync(msgFile, (message ?? '') + '\n')
    const node = `"${process.execPath.replace(/\\/g, '/')}"`
    const q = (p: string) => `"${p.replace(/\\/g, '/')}"`
    const parents = (await this.data(['rev-list', '--parents', '-n', '1', sha])).trim().split(' ')
    const base = parents.length > 1 ? [`${sha}^`] : ['--root']
    try {
      return await this.run(
        action === 'reword' ? `Edit message of ${sha.slice(0, 7)}` : `Drop ${sha.slice(0, 7)}`,
        ['rebase', '-i', '--autostash', ...base],
        undefined,
        {
          ELECTRON_RUN_AS_NODE: '1',
          GIT_SEQUENCE_EDITOR: `${node} ${q(seq)}`,
          GIT_EDITOR: `${node} ${q(ed)}`
        }
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  async rewordCommit(sha: string, message: string): Promise<CommandResult> {
    const head = readSubmoduleHead(this.root)
    if (head && head === sha) {
      const dir = mkdtempSync(join(tmpdir(), 'odysseus-msg-'))
      const f = join(dir, 'MSG')
      writeFileSync(f, message + '\n')
      try {
        // --only with no paths: change the message, ignore whatever is staged.
        return await this.run('Edit commit message', ['commit', '--amend', '--only', '--cleanup=strip', '-F', f])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    return this.scriptedRebase(sha, 'reword', message)
  }

  dropCommit(sha: string): Promise<CommandResult> {
    return this.scriptedRebase(sha, 'drop')
  }

  // ---------------------------------------------------------------- conflicts

  /** Resolve a conflicted file by taking one side wholesale, then mark it resolved. */
  async resolveConflict(path: string, side: 'ours' | 'theirs'): Promise<void> {
    // That side deleted the file: taking it means deleting the file.
    if (!(await this.conflictSides(path))[side]) {
      await this.write(['rm', '-q', '--', path])
      return
    }
    await this.write(['checkout', `--${side}`, '--', path])
    await this.write(['add', '--', path])
  }

  /** Writes a hand-merged result over the conflicted file and marks it resolved. */
  async saveResolution(path: string, content: string): Promise<void> {
    const rel = relative(this.root, resolve(this.root, path))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside the repository')
    writeFileSync(join(this.root, rel), content)
    await this.write(['add', '--', path])
  }

  /** Which sides of a conflict have a file (index stages 2 and 3); one is missing when it was deleted there. */
  async conflictSides(path: string): Promise<{ ours: boolean; theirs: boolean }> {
    const out = await this.data(['ls-files', '-u', '-z', '--', path]).catch(() => '')
    const stages = new Set(out.split('\0').map((r) => r.match(/^\d+ [0-9a-f]+ (\d)\t/)?.[1]))
    return { ours: stages.has('2'), theirs: stages.has('3') }
  }

  conflictContent(path: string): string {
    try {
      return readFileSync(join(this.root, path), 'utf8')
    } catch {
      return ''
    }
  }

  // ---------------------------------------------------------------- submodules

  /**
   * Lists submodules without `git submodule status`, which walks every submodule and takes
   * seconds on Windows. Instead: parse .gitmodules, read recorded commits with one
   * `git ls-files --stage`, and read each checked-out commit straight from its HEAD file.
   */
  async submodules(depth = 0, prefix = ''): Promise<Submodule[]> {
    const modulesFile = join(this.root, '.gitmodules')
    if (!existsSync(modulesFile)) return []
    const entries = parseGitmodules(readFileSync(modulesFile, 'utf8'))
    if (!entries.length) return []

    // Gitlinks (mode 160000) in the index: "<mode> <sha> <stage>\t<path>"
    const staged = await this.data(['ls-files', '--stage', '-z', '--', ...entries.map((e) => e.path)])
    const recorded = new Map<string, { sha: string; conflict: boolean }>()
    for (const rec of staged.split('\0')) {
      const m = rec.match(/^160000 ([0-9a-f]+) (\d)\t(.+)$/)
      if (!m) continue
      const prev = recorded.get(m[3])
      recorded.set(m[3], { sha: m[2] === '0' ? m[1] : prev?.sha ?? m[1], conflict: m[2] !== '0' || !!prev?.conflict })
    }

    const out: Submodule[] = []
    for (const e of entries) {
      const rec = recorded.get(e.path)
      const head = readSubmoduleHead(join(this.root, e.path))
      let state: Submodule['state'] = 'ok'
      if (rec?.conflict) state = 'conflict'
      else if (!head) state = 'uninitialized'
      else if (rec && head !== rec.sha) state = 'modified'
      out.push({ name: e.name, path: prefix + e.path, url: e.url ?? '', branch: e.branch, sha: head ?? rec?.sha ?? '', state, depth })
      // Nested submodules (a submodule's own .gitmodules), a few levels deep.
      if (head && depth < 3 && existsSync(join(this.root, e.path, '.gitmodules'))) {
        const inner = new GitRepo(join(this.root, e.path), this.git)
        out.push(...(await inner.submodules(depth + 1, prefix + e.path + '/').catch(() => [])))
      }
    }
    return out
  }

  async superproject(): Promise<string | null> {
    const out = await this.data(['rev-parse', '--show-superproject-working-tree']).catch(() => '')
    return out.trim() || null
  }

  submoduleUpdate(paths: string[] = [], opts: { init?: boolean; remote?: boolean } = {}): Promise<CommandResult> {
    const args = ['submodule', 'update', '--recursive', '--progress']
    if (opts.init ?? true) args.push('--init')
    if (opts.remote) args.push('--remote')
    if (paths.length) args.push('--', ...paths)
    return this.run(paths.length === 1 ? `Update submodule ${paths[0]}` : 'Update submodules', args)
  }

  submoduleSync(): Promise<CommandResult> {
    return this.run('Sync submodule URLs', ['submodule', 'sync', '--recursive'])
  }

  submoduleAdd(url: string, path: string, branch?: string): Promise<CommandResult> {
    // git >= 2.38.1 refuses file:// / local-path submodule clones by default. A local path
    // typed by the user is an explicit choice, so allow it for this command only.
    const local = !/^[a-z]+:\/\//i.test(url) && !/^[\w.-]+@[\w.-]+:/.test(url)
    const args = [...(local ? ['-c', 'protocol.file.allow=always'] : []), 'submodule', 'add', '--progress']
    if (branch) args.push('-b', branch)
    args.push('--', url, path)
    return this.run(`Add submodule ${path}`, args)
  }

  submoduleDeinit(path: string): Promise<CommandResult> {
    return this.run(`Deinit submodule ${path}`, ['submodule', 'deinit', '-f', '--', path])
  }

  stashApply(ref: string, pop: boolean): Promise<CommandResult> {
    return this.run(pop ? `Pop ${ref}` : `Apply ${ref}`, ['stash', pop ? 'pop' : 'apply', ref])
  }

  stashDrop(ref: string): Promise<CommandResult> {
    return this.run(`Drop ${ref}`, ['stash', 'drop', ref])
  }
}

// ------------------------------------------------------------------ submodule helpers

/** Minimal .gitmodules parser: [submodule "name"] sections with path / url / branch. */
export function parseGitmodules(text: string): { name: string; path: string; url?: string; branch?: string }[] {
  const out: { name: string; path: string; url?: string; branch?: string }[] = []
  let cur: Record<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const section = line.match(/^\[submodule\s+"(.+)"\]$/)
    if (section) {
      cur = { name: section[1] }
      out.push(cur as never)
      continue
    }
    if (line.startsWith('[')) {
      cur = null
      continue
    }
    const kv = line.match(/^([\w.-]+)\s*=\s*(.*)$/)
    if (cur && kv) cur[kv[1].toLowerCase()] = kv[2].replace(/^"(.*)"$/, '$1')
  }
  return out.filter((e) => e.path)
}

/** Commit a submodule checkout points at, read from its git dir; null if not checked out. */
export function readSubmoduleHead(dir: string): string | null {
  const dotGit = join(dir, '.git')
  let gitDir: string
  try {
    const st = statSync(dotGit)
    if (st.isDirectory()) gitDir = dotGit
    else {
      const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m)
      if (!m) return null
      gitDir = isAbsolute(m[1]) ? m[1] : resolve(dir, m[1])
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
    const ref = head.match(/^ref:\s*(.+)$/)
    if (!ref) return /^[0-9a-f]{40,64}$/.test(head) ? head : null
    const loose = join(gitDir, ref[1])
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    const packed = join(gitDir, 'packed-refs')
    if (existsSync(packed)) {
      const line = readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(' ' + ref[1]))
      if (line) return line.split(' ')[0]
    }
    return null
  } catch {
    return null
  }
}
