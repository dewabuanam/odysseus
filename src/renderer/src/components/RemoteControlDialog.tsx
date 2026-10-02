import { useState } from 'react'
import { api } from '../api'
import { Modal } from '../ui'

const DOCS = 'https://code.claude.com/docs/en/remote-control'

/**
 * Shown the first time Remote Control is turned on: what it does, what it needs, and whether
 * it becomes the default for every repository and workspace or only the one in view (`label`).
 */
export function RemoteControlDialog({ label, onClose, onEnable }: { label: string | null; onClose(): void; onEnable(everywhere: boolean): void }) {
  const [every, setEvery] = useState(true)
  return (
    <Modal onClose={onClose}>
      <h3>Remote Control</h3>
      <div className="remote-intro">
        <p>
          Remote Control lets you keep working with a Claude Code session from <b>claude.ai/code</b> or the <b>Claude app</b> on your phone,
          tablet or another computer. The session still runs here, in this repository, with your files, tools and Git hooks.
          The browser or app is only a window into it.
        </p>
        <ul>
          <li>Start a task at your desk and check on it, answer its questions or approve its changes from anywhere.</li>
          <li>Each session shows up in your Claude session list under the repository or workspace name.</li>
          <li>The session ends when you close it here.</li>
        </ul>
        <p className="dim">
          Needs Claude Code signed in with a claude.ai account on a Pro, Max, Team or Enterprise plan. On Team and Enterprise an
          admin has to allow it. Other AI programs keep working as before.{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); api.openUrl(DOCS) }}>Learn more</a>
        </p>
      </div>
      <label className="check">
        <input type="checkbox" checked={every} onChange={(e) => setEvery(e.target.checked)} />
        Turn on Remote Control for every repository and workspace by default
      </label>
      <div className="faint" style={{ fontSize: 12, margin: '4px 0 0 22px' }}>
        {every || !label
          ? 'Each repository or workspace can still turn it off with the Remote button in the AI pane. Change the default in the palette or Settings.'
          : `Only ${label} gets Remote Control. Others follow the default (off).`}
      </div>
      <div className="buttons">
        <button className="btn" onClick={onClose}>Not now</button>
        <button className="btn primary" autoFocus onClick={() => onEnable(every)}>Turn on</button>
      </div>
    </Modal>
  )
}
