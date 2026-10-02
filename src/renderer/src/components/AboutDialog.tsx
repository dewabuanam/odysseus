import { useEffect, useState } from 'react'
import { api } from '../api'
import { Modal, useUi } from '../ui'
import logo from '../assets/logo.png'

export const HOMEPAGE = 'https://github.com/dewabuanam/odysseus'

type Info = Awaited<ReturnType<typeof api.appInfo>>

/** Help > About: version, runtime and Git versions, and links to the project page. */
export function AboutDialog({ onClose }: { onClose(): void }) {
  const ui = useUi()
  const [info, setInfo] = useState<Info | null>(null)
  const [git, setGit] = useState<string>('')

  useEffect(() => {
    api.appInfo().then(setInfo)
    api.diagnostics().then((d) => setGit(d.gitVersion.replace(/^git version\s*/, '')), () => setGit('not found'))
  }, [])

  const rows: [string, string][] = info
    ? [
        ['Version', info.version],
        ['Git', git || '…'],
        ['Electron', info.electron],
        ['Chromium', info.chrome],
        ['Node.js', info.node],
        ['System', info.os]
      ]
    : []

  const copy = () => {
    navigator.clipboard.writeText(['Odysseus', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n'))
    ui.toast('Version info copied')
  }

  return (
    <Modal onClose={onClose}>
      <div className="about">
        <img src={logo} alt="" className="about-logo" />
        <h2>ODYSSEUS</h2>
        <div className="about-tag">A Git client that takes your hooks seriously.</div>
        {info && <div className="about-version">Version {info.version}</div>}
        <table className="about-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="dim">{k}</td>
                <td className="mono">{v}</td>
              </tr>
            ))}
            {info && (
              <tr>
                <td className="dim">Data</td>
                <td className="mono">
                  <a href="#" onClick={(e) => { e.preventDefault(); api.openExternal(info.dataDir) }} title="Open the settings and history folder">
                    {info.dataDir}
                  </a>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="about-links">
          <a href="#" onClick={(e) => { e.preventDefault(); api.openUrl(HOMEPAGE) }}>{HOMEPAGE.replace('https://', '')}</a>
          <span className="faint">·</span>
          <a href="#" onClick={(e) => { e.preventDefault(); api.openUrl(`${HOMEPAGE}/releases`) }}>Releases and updates</a>
          <span className="faint">·</span>
          <a href="#" onClick={(e) => { e.preventDefault(); api.openUrl(`${HOMEPAGE}/blob/main/LICENSE`) }}>MIT License</a>
        </div>
        <div className="buttons">
          <button className="btn" onClick={copy} disabled={!info}>Copy version info</button>
          <button className="btn primary" onClick={onClose} autoFocus>Close</button>
        </div>
      </div>
    </Modal>
  )
}
