// End-to-end tests for the git/hook engine against real temporary repositories.
// Run with: npm test
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookEvent, Settings } from '../src/shared/types'
import { buildEnv } from '../src/main/env'
import { GitRunner } from '../src/main/git/runner'
import { GitRepo } from '../src/main/git/repo'
import { HookService } from '../src/main/git/hooks'
import { layoutGraph } from '../src/main/git/parsers'
import { parseSearch } from '../src/shared/search'
import { mergeResult, parseConflicts } from '../src/shared/conflicts'
import { aggregateAi } from '../src/shared/types'
import { detectAiState } from '../src/renderer/src/aiState'

const settings: Settings = {
  extraPath: [],
  useLoginShellEnv: false,
  forceColor: true,
  hookTimeoutSec: 0,
  gitPath: 'git',
  theme: 'dark'
}

const hookEvents: HookEvent[] = []
let output = ''
const runner = new GitRunner({
  settings: () => settings,
  env: (extra) =>
    buildEnv(settings, {
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      // Allow local-path submodule clones in tests (blocked by default since git 2.38.1).
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'protocol.file.allow',
      GIT_CONFIG_VALUE_0: 'always',
      ...extra
    }),
  events: {
    runQueued: () => {},
    runStart: () => {},
    output: (e) => (output += e.text),
    hook: (e) => hookEvents.push(e),
    runEnd: () => {}
  }
})

const results: { name: string; ok: boolean; err?: string }[] = []
async function test(name: string, fn: () => Promise<void>) {
  hookEvents.length = 0
  output = ''
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    results.push({ name, ok: false, err: (e as Error).stack })
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${(e as Error).message}`)
  }
}

function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } })
}

function writeHook(dir: string, name: string, body: string) {
  const p = join(dir, '.git', 'hooks', name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'odysseus-test-'))
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'core.autocrlf', 'false')
  sh(dir, 'config', 'user.name', 'Test')
  sh(dir, 'config', 'user.email', 't@example.com')
  const repo = new GitRepo(dir, runner)
  const hooks = new HookService(dir, runner, () => process.env.PATH || '')
  console.log(`repo: ${dir}\n`)

  await test('empty repo: status and log', async () => {
    const s = await repo.status()
    assert.equal(s.branch, 'main')
    const l = await repo.log()
    assert.equal(l.commits.length, 0)
  })

  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
  writeFileSync(join(dir, 'a.txt'), lines.join('\n') + '\n')
  writeFileSync(join(dir, 'b.txt'), 'hello\n')

  await test('stage + first commit (no hooks)', async () => {
    let s = await repo.status()
    assert.equal(s.unstaged.length, 2)
    await repo.stageAll()
    s = await repo.status()
    assert.equal(s.staged.length, 2)
    const r = await repo.commit({ message: 'initial commit' })
    assert.ok(r.ok, r.stderr)
    assert.equal(hookEvents.length, 0)
  })

  await test('hunk staging: stage only the first of two hunks', async () => {
    const edited = [...lines]
    edited[1] = 'CHANGED 2'
    edited[27] = 'CHANGED 28'
    writeFileSync(join(dir, 'a.txt'), edited.join('\n') + '\n')
    const d = await repo.diff({ kind: 'unstaged', path: 'a.txt' })
    assert.ok(d)
    assert.equal(d!.hunks.length, 2)
    await repo.applyHunk(d!, 0, null, 'stage')
    const cached = sh(dir, 'diff', '--cached')
    assert.match(cached, /CHANGED 2/)
    assert.doesNotMatch(cached, /CHANGED 28/)
    const staged = await repo.diff({ kind: 'staged', path: 'a.txt' })
    await repo.applyHunk(staged!, 0, null, 'unstage')
    assert.equal(sh(dir, 'diff', '--cached'), '')
  })

  await test('line staging: stage one added line out of two', async () => {
    sh(dir, 'checkout', '--', 'a.txt')
    const edited = [...lines]
    edited.splice(5, 0, 'NEW A', 'NEW B')
    writeFileSync(join(dir, 'a.txt'), edited.join('\n') + '\n')
    const d = (await repo.diff({ kind: 'unstaged', path: 'a.txt' }))!
    const idxA = d.hunks[0].lines.findIndex((l) => l.content === 'NEW A')
    await repo.applyHunk(d, 0, [idxA], 'stage')
    const cached = sh(dir, 'diff', '--cached')
    assert.match(cached, /\+NEW A/)
    assert.doesNotMatch(cached, /NEW B/)
    // discard the remaining unstaged line
    const rest = (await repo.diff({ kind: 'unstaged', path: 'a.txt' }))!
    await repo.applyHunk(rest, 0, null, 'discard')
    assert.equal(sh(dir, 'diff'), '')
    await repo.unstageAll()
    sh(dir, 'checkout', '--', 'a.txt')
  })

  await test('failing pre-commit: hook identified, output streamed, commit blocked', async () => {
    writeHook(dir, 'pre-commit', 'echo "\\033[31mlint: 3 problems\\033[0m"\necho "error detail" >&2\nexit 7')
    writeFileSync(join(dir, 'b.txt'), 'hello world\n')
    await repo.stage(['b.txt'])
    const r = await repo.commit({ message: 'should fail' })
    assert.equal(r.ok, false)
    assert.equal(r.failedHook, 'pre-commit')
    assert.match(output, /lint: 3 problems/)
    assert.match(output, /error detail/)
    const start = hookEvents.find((e) => e.kind === 'start')
    const exit = hookEvents.find((e) => e.kind === 'exit')
    assert.equal(start?.hook, 'pre-commit')
    assert.equal(exit?.exitCode, 7)
    assert.equal((await repo.status()).staged.length, 1, 'staged changes preserved')
  })

  await test('--no-verify bypasses hooks', async () => {
    const r = await repo.commit({ message: 'bypass', noVerify: true })
    assert.ok(r.ok, r.stderr)
    assert.equal(hookEvents.length, 0)
  })

  await test('pre-commit + commit-msg both tracked; nested git calls ignored', async () => {
    // pre-commit runs git itself (like lint-staged does) and must not produce phantom hook events
    writeHook(dir, 'pre-commit', 'git status --short >/dev/null\ngit rev-parse HEAD >/dev/null\necho pre-ok')
    writeHook(dir, 'commit-msg', 'grep -qE "^(feat|fix|chore):" "$1" || { echo "bad message format" >&2; exit 1; }')
    writeFileSync(join(dir, 'b.txt'), 'v3\n')
    await repo.stage(['b.txt'])
    let r = await repo.commit({ message: 'no prefix' })
    assert.equal(r.ok, false)
    assert.equal(r.failedHook, 'commit-msg')
    assert.deepEqual(hookEvents.filter((e) => e.kind === 'start').map((e) => e.hook), ['pre-commit', 'commit-msg'])
    hookEvents.length = 0
    r = await repo.commit({ message: 'feat: multi-line\n\nbody text here' })
    assert.ok(r.ok, r.stderr)
    const exits = hookEvents.filter((e) => e.kind === 'exit')
    assert.deepEqual(exits.map((e) => [e.hook, e.exitCode]), [['pre-commit', 0], ['commit-msg', 0]])
    assert.match(sh(dir, 'log', '-1', '--format=%B'), /body text here/)
  })

  await test('hook that reformats staged files is detectable', async () => {
    writeHook(dir, 'commit-msg', 'exit 0')
    writeHook(dir, 'pre-commit', 'printf "formatted\\n" > b.txt')
    writeFileSync(join(dir, 'b.txt'), 'unformatted\n')
    await repo.stage(['b.txt'])
    const r = await repo.commit({ message: 'fix: format' })
    assert.ok(r.ok)
    const s = await repo.status()
    assert.ok(s.unstaged.some((f) => f.path === 'b.txt'), 'b.txt modified after staging')
    await repo.stageAll()
    await repo.commit({ message: 'chore: apply formatting', noVerify: true })
  })

  await test('cancel kills a hung hook quickly', async () => {
    writeHook(dir, 'pre-commit', 'echo waiting\nsleep 30')
    writeFileSync(join(dir, 'b.txt'), 'cancel me\n')
    await repo.stage(['b.txt'])
    const t0 = Date.now()
    const p = runner.run(dir, ['commit', '-m', 'x'], { title: 'c', runId: 'cancel-test' })
    await new Promise((r) => setTimeout(r, 1500))
    assert.ok(runner.cancel('cancel-test'))
    const r = await p
    assert.equal(r.cancelled, true)
    assert.ok(Date.now() - t0 < 10000, 'cancelled within 10s')
    assert.match(output, /waiting/)
  })

  await test('hook timeout setting kills slow hooks', async () => {
    settings.hookTimeoutSec = 1
    try {
      const r = await repo.commit({ message: 'x' })
      assert.equal(r.cancelled, true)
      assert.match(output, /exceeded 1s timeout/)
    } finally {
      settings.hookTimeoutSec = 0
    }
  })

  await test('hooks overview: detects hooks, missing commands, enable/disable', async () => {
    writeHook(dir, 'pre-commit', 'npx definitely-not-a-real-cmd-xyz\nodysseus-missing-tool --check')
    writeHook(dir, 'pre-push', 'pnpm test')
    let o = await hooks.overview()
    assert.ok(o.hooks.find((h) => h.name === 'pre-commit')?.enabled)
    assert.ok(o.hooks.find((h) => h.name === 'commit-msg')?.exists)
    const fakePath = new HookService(dir, runner, () => '')
    o = await fakePath.overview()
    assert.ok(o.missingCommands.includes('npx'))
    assert.ok(o.missingCommands.includes('pnpm'))
    await hooks.setEnabled('pre-commit', false)
    o = await hooks.overview()
    const pc = o.hooks.find((h) => h.name === 'pre-commit')!
    assert.equal(pc.enabled, false)
    assert.equal(pc.exists, true)
    const r = await repo.commit({ message: 'feat: hooks disabled' })
    assert.ok(r.ok, r.stderr)
    assert.ok(!hookEvents.some((e) => e.hook === 'pre-commit'))
    await hooks.setEnabled('pre-commit', true)
    assert.equal((await hooks.overview()).hooks.find((h) => h.name === 'pre-commit')!.enabled, true)
  })

  await test('run a hook in isolation (git hook run) with a draft message', async () => {
    writeHook(dir, 'commit-msg', 'echo "checking: $(cat "$1")"; grep -q "^feat" "$1"')
    let r = await hooks.run('commit-msg', 'feat: draft')
    assert.ok(r.ok, r.stderr)
    assert.match(output, /checking: feat: draft/)
    assert.equal(hookEvents.find((e) => e.kind === 'exit')?.exitCode, 0)
    r = await hooks.run('commit-msg', 'oops')
    assert.equal(r.ok, false)
    assert.equal(r.failedHook, 'commit-msg')
  })

  await test('core.hooksPath (husky-style) is respected', async () => {
    const huskyDir = join(dir, '.husky', '_')
    execFileSync('mkdir', ['-p', huskyDir])
    writeFileSync(join(huskyDir, 'pre-commit'), '#!/bin/sh\necho husky-ran\nexit 1\n')
    chmodSync(join(huskyDir, 'pre-commit'), 0o755)
    sh(dir, 'config', 'core.hooksPath', '.husky/_')
    const o = await hooks.overview()
    assert.equal(o.customPath, true)
    assert.equal(o.manager, 'husky')
    assert.match(o.hooksDir.replace(/\\/g, '/'), /\.husky\/_$/)
    writeFileSync(join(dir, 'b.txt'), 'husky\n')
    await repo.stage(['b.txt'])
    const r = await repo.commit({ message: 'feat: x' })
    assert.equal(r.failedHook, 'pre-commit')
    assert.match(output, /husky-ran/)
    sh(dir, 'config', '--unset', 'core.hooksPath')
    rmSync(join(dir, '.husky'), { recursive: true, force: true })
    await repo.unstageAll()
  })

  await test('branches, merge graph and commit detail', async () => {
    rmSync(join(dir, '.git', 'hooks', 'pre-commit'), { force: true })
    rmSync(join(dir, '.git', 'hooks', 'commit-msg'), { force: true })
    sh(dir, 'checkout', '-q', '--', '.')
    sh(dir, 'checkout', '-q', '-b', 'feature/x')
    writeFileSync(join(dir, 'c.txt'), 'feature\n')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-qm', 'feature work')
    sh(dir, 'checkout', '-q', 'main')
    writeFileSync(join(dir, 'd.txt'), 'main work\n')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-qm', 'main work')
    const r = await repo.merge('feature/x')
    assert.ok(r.ok, r.stderr)
    const b = await repo.branches()
    assert.ok(b.find((x) => x.name === 'feature/x' && !x.remote))
    assert.ok(b.find((x) => x.name === 'main')?.current)
    const { commits, graph } = await repo.log()
    assert.equal(commits[0].parents.length, 2)
    assert.ok(commits.some((c) => c.refs.some((r) => r.name === 'feature/x' && r.type === 'branch')), 'slash branch labelled local')
    assert.ok(graph.some((g) => g.width >= 2), 'graph has two lanes')
    assert.equal(graph.length, commits.length)
    const detail = await repo.commitDetail(commits[0].sha)
    assert.equal(detail.parents.length, 2)
    const root = commits[commits.length - 1]
    const rootDetail = await repo.commitDetail(root.sha)
    assert.equal(rootDetail.files.length, 2)
    const rd = await repo.diff({ kind: 'commit', sha: root.sha, path: 'b.txt' })
    assert.equal(rd?.isNew, true)
  })

  await test('graph layout unit: fork + merge', async () => {
    const mk = (sha: string, parents: string[]) => ({ sha, parents, author: '', email: '', date: 0, subject: '', refs: [] })
    const rows = layoutGraph([mk('M', ['A', 'B']), mk('B', ['C']), mk('A', ['C']), mk('C', [])])
    assert.equal(rows[0].lane, 0)
    assert.equal(rows[1].lane, 1)
    assert.equal(rows[2].lane, 0)
    assert.equal(rows[3].lane, 0)
    assert.ok(rows[3].top.some((e) => e.fromLane === 1 && e.toLane === 0), 'lane 1 converges into C')
  })

  await test('graph layout unit: shared commit takes the checked-out, then newest, line color', async () => {
    type Ref = { name: string; type: 'head' | 'branch' }
    const mk = (sha: string, parents: string[], date: number, refs: Ref[] = []) =>
      ({ sha, parents, author: '', email: '', date, subject: '', refs })
    // A (older tip) and B (newer tip) both fork from C, where `main` points.
    const byDate = layoutGraph([mk('A', ['C'], 1), mk('B', ['C'], 2), mk('C', [], 0, [{ name: 'main', type: 'branch' }])])
    assert.equal(byDate[2].lane, 0, 'lane positions unchanged')
    assert.equal(byDate[2].color, byDate[1].color, 'newest tip wins')
    // Same shape, but the older A is checked out.
    const head: Ref[] = [{ name: 'HEAD', type: 'head' }, { name: 'a', type: 'branch' }]
    const byHead = layoutGraph([mk('A', ['C'], 1, head), mk('B', ['C'], 2), mk('C', [], 0)])
    assert.equal(byHead[2].color, byHead[0].color, 'checked-out branch wins over a newer one')
  })

  await test('untracked file diff and stash round-trip', async () => {
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')
    const d = await repo.diff({ kind: 'unstaged', path: 'new.txt', untracked: true })
    assert.equal(d?.hunks[0].lines[0].content, 'brand new')
    const r = await repo.stash('wip')
    assert.ok(r.ok, r.stderr)
    assert.equal((await repo.stashes()).length, 1)
    await repo.stashApply('stash@{0}', true)
    assert.equal(readFileSync(join(dir, 'new.txt'), 'utf8'), 'brand new\n')
  })

  await test('submodules: add, detect state, update, deinit, superproject', async () => {
    const lib = mkdtempSync(join(tmpdir(), 'odysseus-lib-'))
    sh(lib, 'init', '-q', '-b', 'main')
    writeFileSync(join(lib, 'lib.txt'), 'v1\n')
    sh(lib, 'add', '.')
    sh(lib, 'commit', '-qm', 'lib v1')

    let r = await repo.submoduleAdd(lib, 'vendor/lib')
    assert.ok(r.ok, r.stderr)
    let subs = await repo.submodules()
    assert.equal(subs.length, 1)
    assert.equal(subs[0].path, 'vendor/lib')
    assert.equal(subs[0].state, 'ok')
    let s = await repo.status()
    assert.ok(s.staged.some((f) => f.path === 'vendor/lib' && f.submodule), 'staged submodule flagged')
    r = await repo.commit({ message: 'add lib submodule' })
    assert.ok(r.ok, r.stderr)

    // new commit inside the submodule -> parent sees it as modified
    const subDir = join(dir, 'vendor', 'lib')
    writeFileSync(join(subDir, 'lib.txt'), 'v2\n')
    sh(subDir, 'commit', '-qam', 'lib v2')
    s = await repo.status()
    const entry = s.unstaged.find((f) => f.path === 'vendor/lib')
    assert.ok(entry?.submodule)
    assert.match(entry!.submoduleState ?? '', /new commits/)
    subs = await repo.submodules()
    assert.equal(subs[0].state, 'modified')

    // update resets it to the recorded commit
    r = await repo.submoduleUpdate(['vendor/lib'])
    assert.ok(r.ok, r.stderr)
    assert.equal((await repo.submodules())[0].state, 'ok')

    // superproject detection from inside the submodule
    const inner = new GitRepo(subDir, runner)
    const parent = await inner.superproject()
    assert.equal(parent?.replace(/\\/g, '/').toLowerCase(), (await GitRepo.resolveRoot(runner, dir)).replace(/\\/g, '/').toLowerCase())

    r = await repo.submoduleDeinit('vendor/lib')
    assert.ok(r.ok, r.stderr)
    assert.equal((await repo.submodules())[0].state, 'uninitialized')
    r = await repo.submoduleUpdate([], { init: true })
    assert.ok(r.ok, r.stderr)
    assert.equal((await repo.submodules())[0].state, 'ok')
    rmSync(lib, { recursive: true, force: true })
  })

  await test('command options: pull modes, merge flags, stash keep-index', async () => {
    const r = await repo.merge('feature/x', { ffOnly: true })
    assert.ok(r.ok, r.stderr) // already merged -> "Already up to date."
    writeFileSync(join(dir, 'a.txt'), 'staged change\n')
    await repo.stage(['a.txt'])
    writeFileSync(join(dir, 'b.txt'), 'unstaged change\n')
    const st = await repo.stash({ message: 'keep', keepIndex: true, includeUntracked: false })
    assert.ok(st.ok, st.stderr)
    const s = await repo.status()
    assert.ok(s.staged.some((f) => f.path === 'a.txt'), 'index kept')
    assert.ok(!s.unstaged.some((f) => f.path === 'b.txt'), 'worktree change stashed')
    await repo.unstageAll()
    sh(dir, 'checkout', '--', 'a.txt')
    await repo.stashApply('stash@{0}', true)
  })

  await test('queue: commands run strictly in order, never concurrently', async () => {
    const order: string[] = []
    let running = 0
    let maxRunning = 0
    const q = new GitRunner({
      settings: () => settings,
      env: (extra) => buildEnv(settings, extra),
      events: {
        runQueued: (e) => order.push(`queued:${e.title}`),
        runStart: (e) => {
          running++
          maxRunning = Math.max(maxRunning, running)
          order.push(`start:${e.title}`)
        },
        output: () => {},
        hook: () => {},
        runEnd: () => running--
      }
    })
    // pull-like slow command, checkout, slow, checkout, slow — fired without awaiting
    writeHook(dir, 'post-checkout', 'sleep 1')
    const slow = (t: string) => q.run(dir, ['hook', 'run', 'post-checkout', '--', 'HEAD', 'HEAD', '1'], { title: t })
    const results = await Promise.all([
      slow('pull 1'),
      q.run(dir, ['checkout', '-q', 'feature/x'], { title: 'checkout feature' }),
      slow('pull 2'),
      q.run(dir, ['checkout', '-q', 'main'], { title: 'checkout main' }),
      slow('pull 3')
    ])
    rmSync(join(dir, '.git', 'hooks', 'post-checkout'), { force: true })
    assert.ok(results.every((r) => r.ok), results.map((r) => r.stderr).join('\n'))
    assert.equal(maxRunning, 1, 'never more than one command at a time')
    assert.deepEqual(
      order.filter((o) => o.startsWith('start:')),
      ['start:pull 1', 'start:checkout feature', 'start:pull 2', 'start:checkout main', 'start:pull 3']
    )
    assert.equal((await repo.status()).branch, 'main')
  })

  await test('queue: cancelling a queued command skips it', async () => {
    writeHook(dir, 'post-checkout', 'sleep 1')
    const first = runner.run(dir, ['hook', 'run', 'post-checkout', '--', 'HEAD', 'HEAD', '1'], { title: 'slow' })
    const second = runner.run(dir, ['checkout', '-q', 'feature/x'], { title: 'queued checkout', runId: 'queued-1' })
    assert.ok(runner.cancel('queued-1'))
    const [a, b] = await Promise.all([first, second])
    rmSync(join(dir, '.git', 'hooks', 'post-checkout'), { force: true })
    assert.ok(a.ok)
    assert.equal(b.cancelled, true)
    assert.equal((await repo.status()).branch, 'main', 'cancelled checkout never ran')
  })

  await test('merge conflict: detected, resolved with a side, continued', async () => {
    sh(dir, 'checkout', '-q', '-b', 'conflict-a')
    writeFileSync(join(dir, 'conflict.txt'), 'base\n')
    sh(dir, 'add', '.')
    sh(dir, 'commit', '-qm', 'base')
    sh(dir, 'checkout', '-q', '-b', 'conflict-b')
    writeFileSync(join(dir, 'conflict.txt'), 'theirs\n')
    sh(dir, 'commit', '-qam', 'b side')
    sh(dir, 'checkout', '-q', 'conflict-a')
    writeFileSync(join(dir, 'conflict.txt'), 'ours\n')
    sh(dir, 'commit', '-qam', 'a side')

    let r = await repo.merge('conflict-b')
    assert.equal(r.ok, false)
    let s = await repo.status()
    assert.equal(s.operation, 'merging')
    assert.deepEqual(s.conflicted.map((f) => f.path), ['conflict.txt'])
    assert.match(repo.conflictContent('conflict.txt'), /<<<<<<<[\s\S]*=======[\s\S]*>>>>>>>/)

    await repo.resolveConflict('conflict.txt', 'theirs')
    s = await repo.status()
    assert.equal(s.conflicted.length, 0)
    assert.equal(readFileSync(join(dir, 'conflict.txt'), 'utf8'), 'theirs\n')
    r = await repo.continueOperation('merging')
    assert.ok(r.ok, r.stderr)
    assert.equal((await repo.status()).operation, null)
    assert.equal(sh(dir, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'merge commit created')
  })

  await test('merge conflict: abort restores the branch', async () => {
    sh(dir, 'checkout', '-q', '-b', 'conflict-c', 'conflict-b~1')
    writeFileSync(join(dir, 'conflict.txt'), 'other\n')
    sh(dir, 'commit', '-qam', 'c side')
    const before = sh(dir, 'rev-parse', 'HEAD').trim()
    const r = await repo.merge('conflict-b')
    assert.equal(r.ok, false)
    assert.equal((await repo.status()).operation, 'merging')
    const a = await repo.abortOperation('merging')
    assert.ok(a.ok, a.stderr)
    assert.equal((await repo.status()).operation, null)
    assert.equal(sh(dir, 'rev-parse', 'HEAD').trim(), before)
  })

  await test('AI status: read from the screen, most urgent wins', async () => {
    const quiet = Date.now() - 10_000
    assert.equal(detectAiState('✶ Thinking… (12s · esc to interrupt)', quiet), 'working')
    assert.equal(detectAiState('Do you want to proceed?\n❯ 1. Yes\n  2. No', quiet), 'waiting')
    assert.equal(detectAiState('Enter to confirm · Esc to cancel', quiet), 'waiting')
    assert.equal(detectAiState('> \n  ? for shortcuts', quiet), 'idle')
    assert.equal(detectAiState('> \n  ? for shortcuts', Date.now()), 'working', 'fresh output counts as working')
    assert.equal(aggregateAi(['idle', 'working', null]), 'working')
    assert.equal(aggregateAi(['idle', 'waiting', 'working']), 'waiting')
    assert.equal(aggregateAi([]), null)
  })

  await test('merge conflict: resolved block by block in the resolver, then a deleted side', async () => {
    sh(dir, 'checkout', '-q', '-b', 'conflict-e', 'conflict-b~1')
    writeFileSync(join(dir, 'conflict.txt'), 'e side\n')
    sh(dir, 'commit', '-qam', 'e side')
    let r = await repo.merge('conflict-b')
    assert.equal(r.ok, false)
    const parts = parseConflicts(repo.conflictContent('conflict.txt'))
    const blocks = parts.filter((p) => p.kind === 'conflict')
    assert.equal(blocks.length, 1)
    assert.equal(mergeResult(parts, ['none']), repo.conflictContent('conflict.txt'), 'unchosen blocks keep their markers')
    await repo.saveResolution('conflict.txt', mergeResult(parts, ['ours-theirs']))
    assert.equal((await repo.status()).conflicted.length, 0)
    assert.equal(readFileSync(join(dir, 'conflict.txt'), 'utf8'), 'e side\ntheirs\n')
    await assert.rejects(repo.saveResolution('../outside.txt', 'x'), /outside the repository/)
    r = await repo.continueOperation('merging')
    assert.ok(r.ok, r.stderr)

    // Deleted on one side, changed on the other: taking the deleting side removes the file.
    sh(dir, 'checkout', '-q', '-b', 'conflict-f', 'conflict-b~1')
    sh(dir, 'rm', '-q', 'conflict.txt')
    sh(dir, 'commit', '-qm', 'f deletes')
    r = await repo.merge('conflict-b')
    assert.equal(r.ok, false)
    assert.deepEqual(await repo.conflictSides('conflict.txt'), { ours: false, theirs: true })
    await repo.resolveConflict('conflict.txt', 'ours')
    assert.equal((await repo.status()).conflicted.length, 0)
    assert.equal(existsSync(join(dir, 'conflict.txt')), false)
    r = await repo.continueOperation('merging')
    assert.ok(r.ok, r.stderr)
  })

  await test('rebase conflict: detected, resolved by editing, continued', async () => {
    sh(dir, 'checkout', '-q', 'conflict-c')
    let r = await repo.rebase('conflict-b')
    assert.equal(r.ok, false)
    let s = await repo.status()
    assert.equal(s.operation, 'rebasing')
    assert.equal(s.conflicted.length, 1)
    writeFileSync(join(dir, 'conflict.txt'), 'hand merged\n')
    await repo.stage(['conflict.txt'])
    r = await repo.continueOperation('rebasing')
    assert.ok(r.ok, r.stderr + r.stdout)
    s = await repo.status()
    assert.equal(s.operation, null)
    assert.equal(readFileSync(join(dir, 'conflict.txt'), 'utf8'), 'hand merged\n')
    assert.equal(sh(dir, 'merge-base', '--is-ancestor', 'conflict-b', 'HEAD'), '')
  })

  await test('rebase conflict: abort', async () => {
    sh(dir, 'checkout', '-q', '-b', 'conflict-d', 'conflict-b~1')
    writeFileSync(join(dir, 'conflict.txt'), 'd side\n')
    sh(dir, 'commit', '-qam', 'd side')
    const r = await repo.rebase('conflict-b')
    assert.equal(r.ok, false)
    const a = await repo.abortOperation('rebasing')
    assert.ok(a.ok, a.stderr)
    assert.equal((await repo.status()).operation, null)
    assert.equal((await repo.status()).branch, 'conflict-d')
  })

  await test('edit history: reword HEAD and an older commit, drop a commit', async () => {
    sh(dir, 'checkout', '-q', '-b', 'history', 'main')
    for (const n of ['one', 'two', 'three']) {
      writeFileSync(join(dir, `${n}.txt`), n + '\n')
      sh(dir, 'add', '.')
      sh(dir, 'commit', '-qm', n)
    }
    const head = sh(dir, 'rev-parse', 'HEAD').trim()
    let r = await repo.rewordCommit(head, 'three (edited)')
    assert.ok(r.ok, r.stderr)
    assert.equal(sh(dir, 'log', '-1', '--format=%s').trim(), 'three (edited)')

    const older = sh(dir, 'rev-parse', 'HEAD~2').trim()
    r = await repo.rewordCommit(older, 'one (edited)')
    assert.ok(r.ok, r.stderr + r.stdout)
    assert.deepEqual(sh(dir, 'log', '-3', '--format=%s').trim().split('\n'), ['three (edited)', 'two', 'one (edited)'])

    const two = sh(dir, 'rev-parse', 'HEAD~1').trim()
    r = await repo.dropCommit(two)
    assert.ok(r.ok, r.stderr + r.stdout)
    assert.deepEqual(sh(dir, 'log', '-2', '--format=%s').trim().split('\n'), ['three (edited)', 'one (edited)'])
    assert.ok(!existsSync(join(dir, 'two.txt')))
  })

  await test('branch management and hidden branches in the log', async () => {
    let r = await repo.renameBranch('history', 'history-renamed')
    assert.ok(r.ok, r.stderr)
    const all = await repo.log(3000, undefined, {})
    const hiddenView = await repo.log(3000, undefined, { hidden: ['refs/heads/conflict-d', 'refs/heads/conflict-c'] })
    assert.ok(hiddenView.commits.length < all.commits.length, 'hidden branches drop their commits')
    assert.ok(!hiddenView.commits.some((c) => c.subject === 'd side'))
    const only = await repo.log(3000, undefined, { only: 'conflict-d' })
    assert.ok(only.commits.some((c) => c.subject === 'd side'))
    assert.ok(!only.commits.some((c) => c.subject === 'three (edited)'))
  })

  await test('search: query language runs on git (author, words, hash, path, merges, branch)', async () => {
    const all = (await repo.log(3000)).commits
    const q = (s: string) => repo.search(parseSearch(s))
    let r = await q('author:"t@x" three')
    assert.ok(r.length >= 1 && r.every((c) => /three/i.test(c.subject)), 'author + word')
    const target = all.find((c) => c.subject === 'main work')!
    r = await q(target.sha.slice(0, 8))
    assert.equal(r[0]?.sha, target.sha, 'hash prefix')
    r = await q('path:c.txt')
    assert.ok(r.some((c) => c.subject === 'feature work') && r.every((c) => c.subject !== 'main work'), 'path')
    r = await q('min-parents:2')
    assert.ok(r.length >= 1 && r.every((c) => c.parents.length >= 2), 'merges only')
    r = await q('max-parents:1 branch:feature/x')
    assert.ok(r.every((c) => c.parents.length <= 1) && r.some((c) => c.subject === 'feature work'), 'branch + no merges')
    assert.deepEqual(parseSearch('author:"John Smith" branch:main fix login'), { text: ['fix', 'login'], paths: [], message: [], regex: [], author: 'John Smith', branch: 'main' })
  })

  await test('search: extended keys (ext, string, regex, merges, date, limit, author:me)', async () => {
    const q = (s: string) => repo.search(parseSearch(s))
    let r = await q('ext:txt')
    assert.ok(r.length > 0 && r.every(Boolean))
    r = await q('string:"feature"')
    assert.ok(r.some((c) => c.subject === 'feature work'), 'pickaxe string')
    r = await q('regex:"^(one|two)"')
    assert.ok(r.length >= 1 && r.every((c) => /^(one|two)/.test(c.subject)), 'message regex')
    r = await q('merges:only')
    assert.ok(r.every((c) => c.parents.length >= 2))
    r = await q('merges:none')
    assert.ok(r.every((c) => c.parents.length <= 1))
    r = await q('date:today')
    assert.ok(r.length > 0, 'today')
    r = await q('limit:2')
    assert.equal(r.length, 2)
    r = await q('author:me')
    assert.ok(r.length > 0 && r.every((c) => c.email === 't@example.com'), 'author:me uses user.email')
    r = await q('fix (a.b)')
    assert.ok(Array.isArray(r), 'special characters in plain words are literal')
  })

  rmSync(dir, { recursive: true, force: true })
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    for (const f of failed) console.log(`\n--- ${f.name}\n${f.err}`)
    process.exit(1)
  }
}

main()
