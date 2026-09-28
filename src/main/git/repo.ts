import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Branch,
  CommandResult,
  Commit,
  CommitDetail,
  CommitOptions,
  FileDiff,
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

  private run(title: string, args: string[], input?: string): Promise<CommandResult> {
    return this.git.run(this.root, args, { title, input })
  }

  async hasHead(): Promise<boolean> {
    try {
      await this.data(['rev-parse', '--verify', '-q', 'HEAD'])
      return true
    } catch {
      return false
    }
  }

  async gitDir(): Promise<string> {
    return (await this.data(['rev-parse', '--absolute-git-dir'])).trim()
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

  async log(limit = 3000): Promise<{ commits: Commit[]; graph: GraphRow[] }> {
    if (!(await this.hasHead())) {
      const anyRefs = (await this.data(['for-each-ref', '--count=1', 'refs/'])).trim()
      if (!anyRefs) return { commits: [], graph: [] }
    }
    const [out, remotes] = await Promise.all([
      this.data([
        'log',
        '--branches',
        '--remotes',
        '--tags',
        ...((await this.hasHead()) ? ['HEAD'] : []),
        '--topo-order',
        `--max-count=${limit}`,
        `--format=${LOG_FORMAT}`
      ]),
      this.remotes()
    ])
    const remoteNames = remotes.map((r) => r.name + '/')
    const commits = parseLog(out)
    for (const c of commits) {
      for (const r of c.refs) {
        if (r.type === 'remote' && !remoteNames.some((n) => r.name.startsWith(n))) r.type = 'branch'
      }
    }
    return { commits, graph: layoutGraph(commits) }
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
    if (paths.length) await this.data(['add', '-A', '--', ...paths])
  }

  async stageAll(): Promise<void> {
    await this.data(['add', '-A'])
  }

  async unstage(paths: string[]): Promise<void> {
    if (!paths.length) return
    if (await this.hasHead()) await this.data(['restore', '--staged', '--', ...paths])
    else await this.data(['rm', '--cached', '-r', '-q', '--', ...paths])
  }

  async unstageAll(): Promise<void> {
    if (await this.hasHead()) await this.data(['reset', '-q'])
    else await this.data(['rm', '--cached', '-r', '-q', '.'])
  }

  async discard(paths: string[], untracked: string[]): Promise<void> {
    if (paths.length) await this.data(['restore', '--worktree', '--', ...paths])
    if (untracked.length) await this.data(['clean', '-f', '-q', '--', ...untracked])
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
    await this.data(args, { input: patch })
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

  merge(ref: string, noVerify = false): Promise<CommandResult> {
    const args = ['merge', '--no-edit', ref]
    if (noVerify) args.splice(1, 0, '--no-verify')
    return this.run(`Merge ${ref}`, args)
  }

  rebase(onto: string): Promise<CommandResult> {
    return this.run(`Rebase onto ${onto}`, ['rebase', onto])
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

  fetch(): Promise<CommandResult> {
    return this.run('Fetch', ['fetch', '--all', '--prune', '--progress'])
  }

  pull(rebase = false): Promise<CommandResult> {
    return this.run('Pull', ['pull', rebase ? '--rebase' : '--no-rebase', '--progress'])
  }

  push(opts: PushOptions): Promise<CommandResult> {
    const args = ['push', '--progress']
    if (opts.force) args.push('--force-with-lease')
    if (opts.noVerify) args.push('--no-verify')
    if (opts.setUpstream) args.push('-u')
    if (opts.remote) args.push(opts.remote)
    if (opts.branch) args.push(opts.branch)
    return this.run('Push', args)
  }

  stash(message?: string, includeUntracked = true): Promise<CommandResult> {
    const args = ['stash', 'push']
    if (includeUntracked) args.push('-u')
    if (message) args.push('-m', message)
    return this.run('Stash', args)
  }

  stashApply(ref: string, pop: boolean): Promise<CommandResult> {
    return this.run(pop ? `Pop ${ref}` : `Apply ${ref}`, ['stash', pop ? 'pop' : 'apply', ref])
  }

  stashDrop(ref: string): Promise<CommandResult> {
    return this.run(`Drop ${ref}`, ['stash', 'drop', ref])
  }
}
