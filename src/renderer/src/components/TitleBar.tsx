import { useEffect, useState } from 'react'
import type { WorkingStatus } from '@shared/types'
import { api } from '../api'
import { formatKeys } from '../palette'
import { isRunActive, norm, useRuns } from '../runs'
import logo from '../assets/logo.png'

interface Props {
  /** Name of the active repository */
  repoName: string | null
  active: string | null
  status: WorkingStatus | null
  /** Superproject path when the active repo is a submodule */
  parent: string | null
  paletteKeys?: string
  onParent(): void
  onPalette(): void
  onBranchMenu(): void
}

/** Frameless window chrome: repository tabs, branch switcher, palette trigger, window controls. */
export function TitleBar({ repoName, active, status, parent, paletteKeys, onParent, onPalette, onBranchMenu }: Props) {
  const [platform, setPlatform] = useState<string>('win32')
  const [maximized, setMaximized] = useState(false)
  const runs = useRuns()
  const activeRuns = runs.filter((r) => active && norm(r.root) === norm(active))
  const running = activeRuns.find(isRunActive)
  const runningHook = running?.steps.find((s) => s.state === 'running')
  const queuedCount = activeRuns.filter((r) => r.startedAt === undefined && r.endedAt === undefined).length

  useEffect(() => {
    api.platform().then(setPlatform)
    api.windowIsMaximized().then(setMaximized)
    return window.ody.on((ch, payload) => ch === 'maximized' && setMaximized(Boolean(payload)))
  }, [])

  const mac = platform === 'darwin'
  const branch = status ? (status.detached ? 'detached HEAD' : status.branch ?? '') : ''

  return (
    <div className={`titlebar ${mac ? 'mac' : ''}`}>
      {!mac && <img src={logo} className="tb-logo" alt="" />}
      {active && (
        <>
          <span className="tb-repo">{repoName}</span>
          {parent && (
            <button className="tb-btn tb-parent" onClick={onParent} title={`Parent repository ${parent}`}>
              ↑ {parent.split(/[\\/]/).pop()}
            </button>
          )}
          <button className="tb-btn tb-branch" onClick={onBranchMenu} title="Checkout branch">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 9.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm7.25-7.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM4.25 1a2.25 2.25 0 0 0-.75 4.37v5.26a2.25 2.25 0 1 0 1.5 0V9.8c.5.3 1.1.45 1.75.45h2.5a2.25 2.25 0 0 0 2.25-2.25v-.63a2.25 2.25 0 1 0-1.5 0v.63c0 .41-.34.75-.75.75h-2.5c-.97 0-1.75-.78-1.75-1.75V5.37A2.25 2.25 0 0 0 4.25 1Z" /></svg>
            {branch}
            {status && status.ahead > 0 && <span className="tb-ab">↑{status.ahead}</span>}
            {status && status.behind > 0 && <span className="tb-ab">↓{status.behind}</span>}
          </button>
        </>
      )}
      <div className="tb-drag" />
      <button className="tb-search" onClick={onPalette}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="5" /><path d="m11 11 3.5 3.5" /></svg>
        <span className="grow ellipsis">
          {runningHook ? `Running ${runningHook.hook}…` : running ? `${running.title}…` : 'Search commands'}
          {queuedCount > 0 && ` (+${queuedCount} queued)`}
        </span>
        {running ? <span className="spinner" /> : paletteKeys && <kbd>{formatKeys(paletteKeys)}</kbd>}
      </button>
      <div className="tb-drag" />
      {!mac && (
        <div className="win-controls">
          <button className="win-btn" onClick={() => api.windowMinimize()} aria-label="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
          </button>
          <button className="win-btn" onClick={() => api.windowToggleMaximize()} aria-label={maximized ? 'Restore' : 'Maximize'}>
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M2.5 2.5V.5h7v7h-2" /><rect x=".5" y="2.5" width="7" height="7" /></svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x=".5" y=".5" width="9" height="9" /></svg>
            )}
          </button>
          <button className="win-btn close" onClick={() => api.windowClose()} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor"><path d="m0 0 10 10M10 0 0 10" /></svg>
          </button>
        </div>
      )}
    </div>
  )
}
