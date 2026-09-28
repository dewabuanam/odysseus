import { useSyncExternalStore } from 'react'
import type { HookEvent, OutputEvent, RunEndEvent, RunStartEvent } from '@shared/types'

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
  title: string
  args: string[]
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  cancelled?: boolean
  failedHook?: string
  output: string
  steps: HookStep[]
}

type Listener = () => void

let runs: RunState[] = []
const listeners = new Set<Listener>()
const MAX_RUNS = 60
const MAX_OUTPUT = 400_000

function emit(): void {
  runs = [...runs]
  listeners.forEach((l) => l())
}

function update(id: string, fn: (r: RunState) => RunState): void {
  const idx = runs.findIndex((r) => r.id === id)
  if (idx === -1) return
  runs[idx] = fn(runs[idx])
  emit()
}

export const runStore = {
  subscribe(l: Listener) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  get: () => runs,
  clear() {
    runs = runs.filter((r) => r.endedAt === undefined)
    emit()
  },
  onStart(e: RunStartEvent) {
    runs = [{ id: e.runId, title: e.title, args: e.args, startedAt: e.time, output: '', steps: [] }, ...runs].slice(0, MAX_RUNS)
    emit()
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
          s.childId === e.childId
            ? { ...s, state: e.exitCode === 0 ? 'ok' : 'fail', exitCode: e.exitCode, durationMs: e.durationMs }
            : s
        )
      }
    })
  },
  onEnd(e: RunEndEvent) {
    update(e.runId, (r) => ({
      ...r,
      endedAt: r.startedAt + e.durationMs,
      exitCode: e.exitCode,
      cancelled: e.cancelled,
      failedHook: e.failedHook,
      // Any step still "running" was killed.
      steps: r.steps.map((s) => (s.state === 'running' ? { ...s, state: 'fail' } : s))
    }))
  }
}

export function useRuns(): RunState[] {
  return useSyncExternalStore(runStore.subscribe, runStore.get)
}

export function useActiveRun(): RunState | undefined {
  return useRuns().find((r) => r.endedAt === undefined)
}
