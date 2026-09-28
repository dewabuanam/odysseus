import { useSyncExternalStore } from 'react'
import type { HistoryEntry, HookEvent, OutputEvent, RunEndEvent, RunQueuedEvent, RunStartEvent } from '@shared/types'

export interface HookStep {
  childId: number
  hook: string
  state: 'running' | 'ok' | 'fail'
  exitCode?: number
  durationMs?: number
  startedAt: number
}

export interface RunState {
  id: string
  root: string
  title: string
  args: string[]
  queuedAt: number
  /** Undefined while the run is waiting in the queue */
  startedAt?: number
  endedAt?: number
  exitCode?: number | null
  cancelled?: boolean
  failedHook?: string
  output: string
  steps: HookStep[]
  /** Loaded from the persisted history of a previous session */
  fromHistory?: boolean
}

type Listener = () => void

let runs: RunState[] = []
const listeners = new Set<Listener>()
const MAX_RUNS = 300
const MAX_OUTPUT = 400_000
let emitScheduled = false

export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

// Output arrives many times a second; batch notifications to one per animation frame.
function emit(): void {
  if (emitScheduled) return
  emitScheduled = true
  requestAnimationFrame(() => {
    emitScheduled = false
    runs = [...runs]
    listeners.forEach((l) => l())
  })
}

function update(id: string, fn: (r: RunState) => RunState): void {
  const idx = runs.findIndex((r) => r.id === id)
  if (idx === -1) return
  runs[idx] = fn(runs[idx])
  emit()
}

const loadedHistory = new Set<string>()

export const runStore = {
  subscribe(l: Listener) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  get: () => runs,
  clear(root: string) {
    runs = runs.filter((r) => norm(r.root) !== norm(root) || r.endedAt === undefined)
    emit()
  },
  /** Seed a tab's console with the persisted command history (once per repository). */
  loadHistory(root: string, entries: HistoryEntry[]) {
    if (loadedHistory.has(norm(root))) return
    loadedHistory.add(norm(root))
    const known = new Set(runs.map((r) => r.id))
    const old: RunState[] = entries
      .filter((h) => !known.has(h.id))
      .map((h) => ({
        id: h.id,
        root: h.root,
        title: h.title,
        args: h.args,
        queuedAt: h.startedAt,
        startedAt: h.startedAt,
        endedAt: h.startedAt + h.durationMs,
        exitCode: h.exitCode,
        cancelled: h.cancelled,
        failedHook: h.failedHook,
        output: h.output,
        steps: [],
        fromHistory: true
      }))
    runs = [...runs, ...old].slice(0, MAX_RUNS)
    emit()
  },
  onQueued(e: RunQueuedEvent) {
    runs = [{ id: e.runId, root: e.root, title: e.title, args: e.args, queuedAt: e.time, output: '', steps: [] }, ...runs].slice(0, MAX_RUNS)
    emit()
  },
  onStart(e: RunStartEvent) {
    if (!runs.some((r) => r.id === e.runId)) this.onQueued({ ...e })
    update(e.runId, (r) => ({ ...r, startedAt: e.time }))
  },
  onOutput(e: OutputEvent) {
    update(e.runId, (r) => {
      let output = r.output + e.text
      if (output.length > MAX_OUTPUT) output = '…(truncated)…\n' + output.slice(-MAX_OUTPUT)
      return { ...r, output }
    })
  },
  onHook(e: HookEvent) {
    update(e.runId, (r) => {
      if (e.kind === 'start') {
        return { ...r, steps: [...r.steps, { childId: e.childId, hook: e.hook, state: 'running', startedAt: e.time }] }
      }
      return {
        ...r,
        steps: r.steps.map((s) =>
          s.childId === e.childId ? { ...s, state: e.exitCode === 0 ? 'ok' : 'fail', exitCode: e.exitCode, durationMs: e.durationMs } : s
        )
      }
    })
  },
  onEnd(e: RunEndEvent) {
    update(e.runId, (r) => ({
      ...r,
      startedAt: r.startedAt ?? Date.now(),
      endedAt: (r.startedAt ?? Date.now()) + e.durationMs,
      exitCode: e.exitCode,
      cancelled: e.cancelled,
      failedHook: e.failedHook,
      steps: r.steps.map((s) => (s.state === 'running' ? { ...s, state: 'fail' } : s))
    }))
  }
}

export function useRuns(root?: string): RunState[] {
  const all = useSyncExternalStore(runStore.subscribe, runStore.get)
  return root ? all.filter((r) => norm(r.root) === norm(root)) : all
}

/** The run currently executing in a repository (not queued, not finished). */
export function useActiveRun(root?: string): RunState | undefined {
  return useRuns(root).find((r) => r.startedAt !== undefined && r.endedAt === undefined)
}

export function useQueued(root?: string): RunState[] {
  return useRuns(root).filter((r) => r.startedAt === undefined && r.endedAt === undefined)
}

export const isRunActive = (r: RunState) => r.startedAt !== undefined && r.endedAt === undefined
