import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CommandResult,
  RunQueuedEvent,
  HookEvent,
  OutputEvent,
  RunEndEvent,
  RunStartEvent,
  Settings
} from '@shared/types'

export interface RunnerEvents {
  runQueued(e: RunQueuedEvent): void
  runStart(e: RunStartEvent): void
  output(e: OutputEvent): void
  hook(e: HookEvent): void
  runEnd(e: RunEndEvent): void
}

export interface RunnerDeps {
  settings(): Settings
  env(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  events: RunnerEvents
}

export class GitError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(message)
  }
}

/** Options that keep machine-readable output stable regardless of user config. */
const DATA_FLAGS = ['-c', 'color.ui=false', '-c', 'core.quotepath=false', '-c', 'log.showSignature=false']

let runCounter = 0

interface ActiveRun {
  child: ChildProcess
  env: NodeJS.ProcessEnv
  cancelled: boolean
}

/**
 * Parses git's trace2 event stream (JSON lines) incrementally. Every `git` process spawned
 * with GIT_TRACE2_EVENT set appends to the same file, including git commands run *inside*
 * hooks (lint-staged, husky...), so we only accept events from the root session id.
 */
export class Trace2HookTracker {
  private offset = 0
  private partial = ''
  private rootSid: string | null = null
  private starts = new Map<number, { hook: string; t: number }>()
  private timer: NodeJS.Timeout | null = null
  lastFailedHook: string | undefined

  constructor(
    public readonly file: string,
    private readonly runId: string,
    private readonly onEvent: (e: HookEvent) => void
  ) {}

  start(): void {
    this.timer = setInterval(() => this.poll(), 120)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.poll()
    try {
      rmSync(this.file, { force: true })
    } catch {
      /* ignore */
    }
  }

  poll(): void {
    if (!existsSync(this.file)) return
    let size: number
    try {
      size = statSync(this.file).size
    } catch {
      return
    }
    if (size <= this.offset) return
    const fd = openSync(this.file, 'r')
    try {
      const buf = Buffer.alloc(size - this.offset)
      readSync(fd, buf, 0, buf.length, this.offset)
      this.offset = size
      this.feed(buf.toString('utf8'))
    } finally {
      closeSync(fd)
    }
  }

  feed(text: string): void {
    const lines = (this.partial + text).split('\n')
    this.partial = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let ev: Record<string, unknown>
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      const sid = String(ev.sid ?? '')
      if (this.rootSid === null && ev.event === 'version') this.rootSid = sid
      if (sid !== this.rootSid) continue
      if (ev.event === 'child_start' && ev.child_class === 'hook') {
        const hook = String(ev.hook_name ?? hookFromArgv(ev.argv) ?? 'hook')
        const childId = Number(ev.child_id)
        const t = Number(ev.t_abs ?? 0)
        this.starts.set(childId, { hook, t })
        this.onEvent({ runId: this.runId, kind: 'start', hook, childId, time: Date.now() })
      } else if (ev.event === 'child_exit') {
        const childId = Number(ev.child_id)
        const started = this.starts.get(childId)
        if (!started) continue
        this.starts.delete(childId)
        const exitCode = Number(ev.code)
        if (exitCode !== 0) this.lastFailedHook = started.hook
        this.onEvent({
          runId: this.runId,
          kind: 'exit',
          hook: started.hook,
          childId,
          exitCode,
          durationMs: Math.round(Number(ev.t_rel ?? 0) * 1000),
          time: Date.now()
        })
      }
    }
  }

  /** Hooks still running (used for timeouts / cancel reporting). */
  running(): string[] {
    return [...this.starts.values()].map((s) => s.hook)
  }
}

function hookFromArgv(argv: unknown): string | null {
  if (!Array.isArray(argv) || argv.length === 0) return null
  const first = String(argv[0])
  const m = first.match(/([a-z-]+)$/)
  return m ? m[1] : null
}

function execText(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

/**
 * Windows: hooks run under Git for Windows' MSYS shell. MSYS emulates fork+exec, which breaks
 * the Windows parent-process chain: `taskkill /T` on git.exe leaves `sleep`, `node`, test
 * runners etc. alive. We combine the Windows process table with MSYS's own table (whose
 * PPIDs survive exec) to find every descendant.
 */
async function windowsDescendants(rootPid: number, env: NodeJS.ProcessEnv): Promise<number[]> {
  const winTable = await execText('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
  ])
  const winChildren = new Map<number, number[]>()
  for (const line of winTable.split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid) continue
    if (!winChildren.has(ppid)) winChildren.set(ppid, [])
    winChildren.get(ppid)!.push(pid)
  }
  // MSYS table: PID PPID PGID WINPID ...
  const msysTable = await execText('ps', ['-l'], env)
  const msys: { pid: number; ppid: number; winpid: number }[] = []
  for (const line of msysTable.split(/\r?\n/).slice(1)) {
    const cols = line.replace(/^[^\d]*/, '').trim().split(/\s+/)
    if (cols.length < 4) continue
    msys.push({ pid: Number(cols[0]), ppid: Number(cols[1]), winpid: Number(cols[3]) })
  }

  const found = new Set<number>([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const pid of [...found]) {
      for (const c of winChildren.get(pid) ?? []) if (!found.has(c)) { found.add(c); changed = true }
    }
    const msysInTree = new Set(msys.filter((p) => found.has(p.winpid)).map((p) => p.pid))
    for (const p of msys) {
      if (msysInTree.has(p.ppid) && !found.has(p.winpid)) {
        found.add(p.winpid)
        changed = true
      }
    }
  }
  return [...found]
}

async function killTree(child: ChildProcess, env: NodeJS.ProcessEnv): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const pids = await windowsDescendants(child.pid, env).catch(() => [child.pid!])
    const args = pids.flatMap((p) => ['/PID', String(p)])
    await execText('taskkill', ['/F', '/T', ...args])
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

export class GitRunner {
  private active = new Map<string, ActiveRun>()
  /** Tail of each repository's queue. Every write goes through here, strictly in order. */
  private lanes = new Map<string, Promise<void>>()
  private cancelledQueued = new Set<string>()
  private queuedIds = new Set<string>()

  /**
   * Runs `fn` after everything already queued for `key` has finished (successfully or not).
   * Pull, checkout, pull, checkout, pull executes in exactly that order, never concurrently,
   * so git never trips over its own index.lock.
   */
  async inQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const norm = key.replace(/\\/g, '/').toLowerCase()
    const prev = this.lanes.get(norm) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const tail = prev.then(() => mine)
    this.lanes.set(norm, tail)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.lanes.get(norm) === tail) this.lanes.delete(norm)
    }
  }

  /** A write that isn't user-visible as a run (stage, unstage, apply hunk) but must respect the queue. */
  mutate(cwd: string, args: string[], opts: { input?: string; allowExit?: number[] } = {}): Promise<string> {
    return this.inQueue(cwd, () => this.data(cwd, args, opts))
  }

  constructor(private readonly deps: RunnerDeps) {}

  /** Run a read-only "data" command and return stdout. Throws GitError on failure. */
  async data(
    cwd: string,
    args: string[],
    opts: { input?: string; allowExit?: number[] } = {}
  ): Promise<string> {
    // Reads never take optional locks (index refresh), so they can't collide with queued writes.
    const env = this.deps.env({ GIT_OPTIONAL_LOCKS: '0' })
    return new Promise((resolve, reject) => {
      const child = spawn(this.deps.settings().gitPath, [...DATA_FLAGS, ...args], {
        cwd,
        env,
        windowsHide: true
      })
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout.on('data', (d) => out.push(d))
      child.stderr.on('data', (d) => err.push(d))
      child.on('error', (e) => reject(new GitError(e.message, null, e.message)))
      child.on('close', (code) => {
        const stdout = Buffer.concat(out).toString('utf8')
        const stderr = Buffer.concat(err).toString('utf8')
        if (code === 0 || (code !== null && opts.allowExit?.includes(code))) resolve(stdout)
        else reject(new GitError(stderr.trim() || `git ${args[0]} failed (${code})`, code, stderr))
      })
      if (opts.input !== undefined) child.stdin.end(opts.input)
      else child.stdin.end()
    })
  }

  /**
   * Run a user-facing command that may trigger hooks. Output is streamed live to the UI,
   * hook start/exit is tracked through trace2, and the run can be cancelled.
   */
  async run(
    cwd: string,
    args: string[],
    opts: { title: string; input?: string; runId?: string; queueKey?: string; env?: NodeJS.ProcessEnv } = { title: '' }
  ): Promise<CommandResult> {
    const runId = opts.runId ?? `run-${Date.now()}-${++runCounter}`
    const root = opts.queueKey ?? cwd
    this.deps.events.runQueued({ runId, root, title: opts.title, args, time: Date.now() })
    this.queuedIds.add(runId)
    return this.inQueue(root, async () => {
      this.queuedIds.delete(runId)
      if (this.cancelledQueued.delete(runId)) {
        return { ok: false, exitCode: null, cancelled: true, stdout: '', stderr: '' }
      }
      return this.execRun(cwd, args, { ...opts, title: opts.title }, runId, root)
    })
  }

  private async execRun(
    cwd: string,
    args: string[],
    opts: { title: string; input?: string; env?: NodeJS.ProcessEnv },
    runId: string,
    root: string
  ): Promise<CommandResult> {
    const settings = this.deps.settings()
    const traceFile = join(tmpdir(), `odysseus-trace2-${process.pid}-${runCounter}-${Date.now()}.json`)
    const started = Date.now()
    const events = this.deps.events

    let hookTimer: NodeJS.Timeout | null = null
    const tracker = new Trace2HookTracker(traceFile, runId, (e) => {
      events.hook(e)
      if (settings.hookTimeoutSec > 0) {
        if (hookTimer) clearTimeout(hookTimer)
        hookTimer = null
        if (e.kind === 'start') {
          hookTimer = setTimeout(() => {
            events.output({
              runId,
              stream: 'stderr',
              text: `\n[odysseus] Hook "${e.hook}" exceeded ${settings.hookTimeoutSec}s timeout, killing.\n`
            })
            this.cancel(runId)
          }, settings.hookTimeoutSec * 1000)
        }
      }
    })

    const colorEnv: NodeJS.ProcessEnv = settings.forceColor
      ? { FORCE_COLOR: '1', CLICOLOR_FORCE: '1', npm_config_color: 'always' }
      : { NO_COLOR: '1' }
    const env = this.deps.env({
      ...colorEnv,
      ...(opts.env ?? {}),
      GIT_TRACE2_EVENT: traceFile
    })

    events.runStart({ runId, root, title: opts.title, args, time: started })
    tracker.start()

    const child = spawn(settings.gitPath, ['-c', 'core.quotepath=false', ...args], {
      cwd,
      env,
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    const run: ActiveRun = { child, env, cancelled: false }
    this.active.set(runId, run)

    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stdout += text
      events.output({ runId, stream: 'stdout', text })
    })
    child.stderr!.on('data', (d: Buffer) => {
      const text = d.toString('utf8')
      stderr += text
      events.output({ runId, stream: 'stderr', text })
    })
    if (opts.input !== undefined) child.stdin!.end(opts.input)
    else child.stdin!.end()

    const exitCode: number | null = await new Promise((resolve) => {
      child.on('error', (e) => {
        stderr += e.message
        events.output({ runId, stream: 'stderr', text: e.message + '\n' })
        resolve(null)
      })
      child.on('close', (code) => resolve(code))
    })

    if (hookTimer) clearTimeout(hookTimer)
    tracker.stop()
    this.active.delete(runId)

    const ok = exitCode === 0 && !run.cancelled
    const failedHook = ok ? undefined : (tracker.lastFailedHook ?? tracker.running()[0])
    events.runEnd({
      runId,
      exitCode,
      cancelled: run.cancelled,
      durationMs: Date.now() - started,
      failedHook
    })
    return { ok, exitCode, cancelled: run.cancelled, stdout, stderr, failedHook }
  }

  cancel(runId: string): boolean {
    const run = this.active.get(runId)
    if (!run) {
      // Still waiting in the queue: drop it before it starts.
      if (!this.queuedIds.has(runId)) return false
      this.queuedIds.delete(runId)
      this.cancelledQueued.add(runId)
      this.deps.events.runEnd({ runId, exitCode: null, cancelled: true, durationMs: 0 })
      return true
    }
    run.cancelled = true
    void killTree(run.child, run.env).finally(() => {
      // Orphaned grandchildren may still hold our stdio pipes open; stop waiting for them.
      setTimeout(() => {
        run.child.stdout?.destroy()
        run.child.stderr?.destroy()
      }, 1500)
    })
    return true
  }

  cancelAll(): void {
    for (const id of [...this.queuedIds]) this.cancel(id)
    for (const id of this.active.keys()) this.cancel(id)
  }
}
