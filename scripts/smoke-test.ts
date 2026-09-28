// End-to-end tests for the git/hook engine against real temporary repositories.
// Run with: npm test
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HookEvent, Settings } from '../src/shared/types'
import { buildEnv } from '../src/main/env'
import { GitRunner } from '../src/main/git/runner'
import { GitRepo } from '../src/main/git/repo'
import { HookService } from '../src/main/git/hooks'
import { layoutGraph } from '../src/main/git/parsers'

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
      ...extra
    }),
  events: {
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
    // pre-commit runs git itself (like lint-staged does) — must not produce phantom hook events
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

  rmSync(dir, { recursive: true, force: true })
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    for (const f of failed) console.log(`\n--- ${f.name}\n${f.err}`)
    process.exit(1)
  }
}

main()
