import { useEffect, useState } from 'react'
import type { RepoSummary } from '@shared/types'
import { api } from '../api'
import { useUi } from '../ui'
import { formatKeys } from '../palette'
import logo from '../assets/logo.png'

export function Welcome({ onOpen, onWorkspace }: { onOpen(dir: string): void; onWorkspace(): void }) {
  const ui = useUi()
  const [recent, setRecent] = useState<RepoSummary[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.recentRepos().then(setRecent)
  }, [])

  const guard = async (fn: () => Promise<RepoSummary | null>) => {
    setBusy(true)
    try {
      const r = await fn()
      if (r) onOpen(r.path)
    } catch (e) {
      ui.toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <img src={logo} alt="Odysseus" />
        <h1>ODYSSEUS</h1>
        <div className="tag">A Git client that takes your hooks seriously.</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" disabled={busy} onClick={async () => { const d = await api.pickRepo(); if (d) onOpen(d) }}>
            Open repository
          </button>
          <button className="btn" disabled={busy} onClick={() => guard(api.initRepo)}>New repository</button>
          <button className="btn" disabled={busy} onClick={onWorkspace} title="Open every repository in a folder as one tab group">Open workspace folder</button>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              const r = await ui.ask({ title: 'Clone repository', input: { label: 'Repository URL', placeholder: 'https://github.com/user/repo.git' }, confirmLabel: 'Choose folder & clone' })
              if (r) guard(() => api.cloneRepo(r.value))
            }}
          >
            {busy ? <span className="spinner" /> : null} Clone…
          </button>
        </div>
        <div className="faint" style={{ marginTop: 14, fontSize: 12 }}>
          Press <kbd>{formatKeys('Mod+P')}</kbd> for commands, <kbd>{formatKeys('Mod+Shift+O')}</kbd> for recent repositories
        </div>
        {recent.length > 0 && (
          <div className="recent">
            {recent.map((r) => (
              <div key={r.path} className="recent-item" onClick={() => onOpen(r.path)}>
                <span style={{ color: 'var(--gold)' }}>⎇</span>
                <div className="grow">
                  <div>{r.name}</div>
                  <div className="faint ellipsis" style={{ fontSize: 11 }}>{r.path}</div>
                </div>
                <button
                  className="btn ghost small"
                  title="Remove from list"
                  onClick={(e) => {
                    e.stopPropagation()
                    api.removeRecent(r.path).then(() => setRecent((x) => x.filter((y) => y.path !== r.path)))
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
