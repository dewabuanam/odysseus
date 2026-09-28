import { useEffect, useState } from 'react'
import type { EnvDiagnostics, Settings } from '@shared/types'
import { api } from '../api'
import { Modal } from '../ui'

export function SettingsDialog({ onClose, onSaved }: { onClose(): void; onSaved(s: Settings): void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [pathText, setPathText] = useState('')
  const [diag, setDiag] = useState<EnvDiagnostics | null>(null)

  useEffect(() => {
    api.getSettings().then((v) => {
      setS(v)
      setPathText(v.extraPath.join('\n'))
    })
    api.diagnostics().then(setDiag)
  }, [])

  if (!s) return null

  const save = async () => {
    const saved = await api.setSettings({ ...s, extraPath: pathText.split('\n').map((p) => p.trim()).filter(Boolean) })
    onSaved(saved)
    setDiag(await api.diagnostics())
  }

  return (
    <Modal onClose={onClose} wide>
      <h3>Settings</h3>

      <div className="section-head" style={{ marginTop: 0 }}>Hook environment</div>
      <div className="dim" style={{ fontSize: 12, margin: '6px 0 10px' }}>
        Hooks run with this environment. If a hook works in your terminal but fails here, it's almost always a missing PATH entry.
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={s.useLoginShellEnv} onChange={(e) => setS({ ...s, useLoginShellEnv: e.target.checked })} />
          Load environment from login shell (macOS / Linux: picks up nvm, asdf, pyenv, volta, homebrew)
        </label>
      </div>
      <div className="field">
        <span>Extra PATH entries (one per line, prepended)</span>
        <textarea className="textarea" rows={3} value={pathText} placeholder={'e.g. C:\\Users\\me\\AppData\\Roaming\\nvm\\v20.11.0\n/Users/me/.volta/bin'} onChange={(e) => setPathText(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
        <label className="check">
          <input type="checkbox" checked={s.forceColor} onChange={(e) => setS({ ...s, forceColor: e.target.checked })} />
          Force colored hook output
        </label>
        <label className="check">
          Hook timeout
          <input className="input" type="number" min={0} style={{ width: 70 }} value={s.hookTimeoutSec} onChange={(e) => setS({ ...s, hookTimeoutSec: Math.max(0, Number(e.target.value)) })} />
          sec (0 = none)
        </label>
      </div>

      <div className="section-head">General</div>
      <div className="row" style={{ gap: 12, marginTop: 8 }}>
        <div className="field grow">
          <span>Git executable</span>
          <input className="input" value={s.gitPath} onChange={(e) => setS({ ...s, gitPath: e.target.value })} />
        </div>
        <div className="field" style={{ width: 140 }}>
          <span>Theme</span>
          <select className="input" value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value as Settings['theme'] })}>
            <option value="light">Paper</option>
            <option value="dark">Chalkboard</option>
          </select>
        </div>
      </div>

      <div className="section-head">Diagnostics</div>
      {diag ? (
        <div style={{ marginTop: 8 }}>
          <div className="mono" style={{ fontSize: 12, marginBottom: 6 }}>
            {diag.gitVersion} <span className="faint">({diag.gitPath})</span>
          </div>
          {diag.shell && (
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              Login shell {diag.shell}: {diag.loginShellEnvLoaded ? <span style={{ color: 'var(--green)' }}>loaded</span> : <span style={{ color: 'var(--yellow)' }}>not loaded</span>}
            </div>
          )}
          <table>
            <tbody>
              {Object.entries(diag.tools).map(([tool, p]) => (
                <tr key={tool}>
                  <td className="mono" style={{ width: 110 }}>{tool}</td>
                  <td className="mono" style={{ color: p ? 'var(--text-dim)' : 'var(--text-faint)' }}>{p ?? 'not found'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 8, fontSize: 12 }}>
            <summary className="dim" style={{ cursor: 'pointer' }}>Effective PATH ({diag.path.length} entries)</summary>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }}>{diag.path.join('\n')}</pre>
          </details>
        </div>
      ) : (
        <div className="faint">Checking…</div>
      )}

      <div className="buttons">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  )
}
