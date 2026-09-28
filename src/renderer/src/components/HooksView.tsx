import { useEffect, useState } from 'react'
import type { HookInfo, HookName } from '@shared/types'
import { useApi } from '../api'
import { useRepo } from '../repoContext'
import { HOOK_DOCS, HOOK_TEMPLATE, useUi } from '../ui'

const MANAGER_NOTES: Record<string, string> = {
  husky: 'Husky detected. Edit the scripts in .husky/<hook>; files in .husky/_ are generated wrappers.',
  lefthook: 'Lefthook detected. Hook behaviour is configured in lefthook.yml.',
  'pre-commit': 'pre-commit framework detected. Hooks are configured in .pre-commit-config.yaml.',
  overcommit: 'Overcommit detected. Configure hooks in .overcommit.yml.',
  'simple-git-hooks': 'simple-git-hooks detected. Hooks are configured in package.json.'
}

function hookState(h: HookInfo): { cls: string; label: string } {
  if (!h.exists) return { cls: 'off', label: h.sampleOnly ? 'sample only' : 'not installed' }
  if (!h.enabled) return { cls: 'warn', label: 'disabled' }
  if (!h.executable) return { cls: 'fail', label: 'not executable' }
  return { cls: 'ok', label: 'active' }
}

export function HooksView({ selected: selectedProp, onSelect, onOpenSettings }: { selected: string; onSelect(h: HookName): void; onOpenSettings(): void }) {
  const repo = useRepo()
  const api = useApi()
  const ui = useUi()
  const overview = repo.hooks
  const selected = selectedProp as HookName
  const setSelected = onSelect
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [showAll, setShowAll] = useState(false)

  const info = overview?.hooks.find((h) => h.name === selected)

  useEffect(() => {
    let cancelled = false
    api.readHook(selected).then((c) => {
      if (cancelled) return
      const text = c || HOOK_TEMPLATE(selected)
      setContent(text)
      setOriginal(info?.exists ? c : '')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, info?.exists, info?.enabled])

  if (!overview) return <div className="empty">Loading hooks…</div>

  const visible = overview.hooks.filter((h) => showAll || h.exists || ['pre-commit', 'commit-msg', 'pre-push', 'prepare-commit-msg', 'post-checkout', 'post-merge'].includes(h.name))
  const dirty = content !== original
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    if (await repo.mutate(fn, ['hooks'])) ui.toast(msg)
  }

  return (
    <div className="hooks-view">
      <div className="hooks-list">
        <div style={{ padding: '10px 12px' }}>
          <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Hooks directory</div>
          <div className="mono ellipsis" title={overview.hooksDir} style={{ fontSize: 11.5, marginTop: 2 }}>
            <span className="link" onClick={() => api.openExternal(overview.hooksDir)}>{overview.hooksDir}</span>
          </div>
          <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 4 }}>
            {overview.customPath && <span className="pill gold">core.hooksPath</span>}
            {overview.manager && <span className="pill gold">{overview.manager}</span>}
          </div>
        </div>
        {visible.map((h) => {
          const st = hookState(h)
          return (
            <div key={h.name} className={`hook-item ${selected === h.name ? 'active' : ''}`} onClick={() => setSelected(h.name)}>
              <span className={`dot ${st.cls}`} />
              <span className="name grow">{h.name}</span>
              <span className="faint" style={{ fontSize: 11 }}>{st.label}</span>
            </div>
          )
        })}
        <div className="hook-item faint" onClick={() => setShowAll(!showAll)} style={{ fontSize: 12 }}>
          {showAll ? 'Show fewer' : `Show all ${overview.hooks.length} hook types…`}
        </div>
      </div>

      <div className="hook-edit">
        {overview.missingCommands.length > 0 && (
          <div className="info-card warn">
            <b>Hooks reference commands Odysseus can't find:</b>{' '}
            <span className="mono">{overview.missingCommands.join(', ')}</span>
            <div className="dim" style={{ marginTop: 4 }}>
              They'll fail with "command not found" when git runs them from this app. Add their folder to <b>Extra PATH</b> in Settings
              (e.g. your nvm / volta / pyenv bin dir), or enable login-shell environment.
            </div>
            <button className="btn small" style={{ marginTop: 6 }} onClick={onOpenSettings}>Open settings</button>
          </div>
        )}
        {overview.manager && <div className="info-card">{MANAGER_NOTES[overview.manager]}</div>}

        <div className="row">
          <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--gold-2)' }}>{selected}</span>
          {info && <span className={`pill`}>{hookState(info).label}</span>}
          <span className="grow" />
          {info?.exists && (
            <label className="check" title="Disabled hooks are renamed so git ignores them">
              <input type="checkbox" checked={info.enabled} onChange={(e) => act(() => api.setHookEnabled(selected, e.target.checked), e.target.checked ? 'Hook enabled' : 'Hook disabled')} />
              Enabled
            </label>
          )}
          {info?.exists && info.enabled && !info.executable && (
            <button className="btn small" onClick={() => act(() => api.makeHookExecutable(selected), 'Marked executable')}>Make executable</button>
          )}
          <button
            className="btn small"
            disabled={!info?.exists || !info.enabled}
            title="Run this hook now without committing (git hook run)"
            onClick={() => {
              repo.openConsole()
              repo.exec(() => api.runHook(selected, ''), `${selected} passed`)
            }}
          >
            ▶ Run now
          </button>
          {info?.exists && (
            <button
              className="btn small danger"
              onClick={async () => {
                const r = await ui.ask({ title: `Delete ${selected} hook?`, message: 'The script file will be removed.', confirmLabel: 'Delete', danger: true })
                if (r) act(() => api.removeHook(selected), 'Hook deleted')
              }}
            >
              Delete
            </button>
          )}
          <button className="btn small primary" disabled={!dirty} onClick={() => act(async () => { await api.writeHook(selected, content); setOriginal(content) }, info?.exists ? 'Hook saved' : 'Hook installed')}>
            {info?.exists ? 'Save' : 'Install hook'}
          </button>
        </div>
        <div className="dim" style={{ fontSize: 12 }}>{HOOK_DOCS[selected]}</div>
        {info?.interpreter && <div className="faint mono" style={{ fontSize: 11 }}>interpreter: {info.interpreter}</div>}
        <textarea
          className="textarea"
          spellCheck={false}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 's' && (e.ctrlKey || e.metaKey) && dirty) {
              e.preventDefault()
              act(async () => { await api.writeHook(selected, content); setOriginal(content) }, 'Hook saved')
            }
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.currentTarget
              const s = t.selectionStart
              setContent(content.slice(0, s) + '  ' + content.slice(t.selectionEnd))
              requestAnimationFrame(() => (t.selectionStart = t.selectionEnd = s + 2))
            }
          }}
        />
      </div>
    </div>
  )
}
