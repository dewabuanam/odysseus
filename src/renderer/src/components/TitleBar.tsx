import { useEffect, useState } from 'react'
import type { RepoSummary, WorkingStatus } from '@shared/types'
import { api } from '../api'
import { formatKeys } from '../palette'
import { useActiveRun } from '../runs'
import logo from '../assets/logo.png'

interface Props {
  repo: RepoSummary | null
  status: WorkingStatus | null
  onPalette(): void
  onRepoMenu(): void
  onBranchMenu(): void
}

/** Frameless window chrome: drag region, repo/branch switchers, palette trigger, window controls. */
export function TitleBar({ repo, status, onPalette, onRepoMenu, onBranchMenu }: Props) {
  const [platform, setPlatform] = useState<string>('win32')
  const [maximized, setMaximized] = useState(false)
  const activeRun = useActiveRun()
  const runningHook = activeRun?.steps.find((s) => s.state === 'running')

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
      {repo && (
        <>
          <button className="tb-btn tb-repo" onClick={onRepoMenu} title={repo.path}>
            {repo.name}
          </button>
          <span className="tb-slash">/</span>
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
        <span className="grow">{runningHook ? `Running ${runningHook.hook}…` : activeRun ? `${activeRun.title}…` : 'Search commands'}</span>
        {activeRun ? <span className="spinner" /> : <kbd>{formatKeys('Mod+P')}</kbd>}
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
