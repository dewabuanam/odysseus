import { useState, type ReactNode } from 'react'
import type { Branch } from '@shared/types'
import { useApi } from '../api'
import { input } from '../commands'
import { useRepo } from '../repoContext'
import { useUi } from '../ui'

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="sb-section">
      <div className="sb-title" onClick={() => setOpen(!open)}>
        <span style={{ width: 10 }}>{open ? '▾' : '▸'}</span>
        {title}
        {count !== undefined && <span style={{ marginLeft: 'auto', fontWeight: 400 }}>{count}</span>}
      </div>
      {open && children}
    </div>
  )
}

interface Props {
  selected: string | null
  view: 'history' | 'hooks'
  onSelectWorking(): void
  onShowHooks(): void
}

export function Sidebar({ selected, view, onSelectWorking, onShowHooks }: Props) {
  const repo = useRepo()
  const ui = useUi()
  const api = useApi()
  const { status, branches, tags, stashes, remotes, hooks } = repo
  const local = branches.filter((b) => !b.remote)
  const current = local.find((b) => b.current)
  const changes = status ? status.staged.length + status.unstaged.length + status.conflicted.length : 0

  const branchMenu = (e: React.MouseEvent, b: Branch) => {
    e.preventDefault()
    repo.branchMenu(e, b)
  }
  const isHidden = (b: Branch) => repo.hidden.includes(b.fullRef)

  const hookCounts = hooks ? { active: hooks.hooks.filter((h) => h.enabled).length, disabled: hooks.hooks.filter((h) => h.exists && !h.enabled).length } : null

  return (
    <div className="sidebar">
      <div className={`sb-item ${view === 'history' && selected === 'working' ? 'active' : ''}`} style={{ paddingLeft: 12, marginTop: 2 }} onClick={onSelectWorking}>
        <span>◉</span>
        <span>Working Directory</span>
        {changes > 0 && <span className="count" style={{ color: 'var(--gold-2)' }}>{changes}</span>}
      </div>
      <div className={`sb-item ${view === 'hooks' ? 'active' : ''}`} style={{ paddingLeft: 12 }} onClick={onShowHooks}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8" cy="3" r="1.8" /><path d="M8 4.8V14M4.5 7.5h7M2.5 10a5.5 5.5 0 0 0 11 0" /></svg>
        <span>Git Hooks</span>
        {hooks && (
          <span className="count">
            {hooks.missingCommands.length > 0 && <span className="dot warn" style={{ display: 'inline-block', marginRight: 5 }} title="Missing commands" />}
            {hookCounts?.active} active
          </span>
        )}
      </div>

      <Section title="Branches" count={local.length}>
        {local.map((b) => (
          <div
            key={b.fullRef}
            className={`sb-item ${b.current ? 'current' : ''} ${isHidden(b) ? 'hidden-ref' : ''} ${selected === b.sha && view === 'history' ? 'active' : ''}`}
            onClick={() => repo.select(b.sha)}
            onDoubleClick={() => !b.current && repo.exec(() => api.checkout(b.name))}
            onContextMenu={(e) => branchMenu(e, b)}
            title={`${b.upstream ? `tracking ${b.upstream}` : 'no upstream'}${isHidden(b) ? ' (hidden from graph)' : ''}`}
          >
            <span>{b.current ? '●' : '○'}</span>
            <span className="ellipsis">{b.name}</span>
            {(b.ahead || b.behind) ? (
              <span className="ab">
                {b.ahead ? `↑${b.ahead}` : ''}
                {b.behind ? ` ↓${b.behind}` : ''}
              </span>
            ) : null}
          </div>
        ))}
      </Section>

      {remotes.map((r) => {
        const rb = branches.filter((b) => b.remote && b.name.startsWith(r.name + '/'))
        return (
          <Section key={r.name} title={`Remote: ${r.name}`} count={rb.length} defaultOpen={false}>
            {rb.map((b) => (
              <div key={b.fullRef} className={`sb-item ${isHidden(b) ? 'hidden-ref' : ''}`} onClick={() => repo.select(b.sha)} onContextMenu={(e) => branchMenu(e, b)} onDoubleClick={() => repo.exec(() => api.checkoutRemote(b.name))}>
                <span className="faint">⎇</span>
                <span className="ellipsis">{b.name.slice(r.name.length + 1)}</span>
              </div>
            ))}
          </Section>
        )
      })}

      <SubmoduleSection />

      <Section title="Tags" count={tags.length} defaultOpen={false}>
        {tags.map((t) => (
          <div
            key={t.name}
            className="sb-item"
            onClick={() => repo.select(t.sha)}
            onContextMenu={(e) => {
              e.preventDefault()
              ui.menu(e, [
                { label: 'Checkout (detached)', action: () => repo.exec(() => api.checkout(t.name)) },
                { label: 'Push tag', action: () => repo.exec(() => api.push({ remote: remotes[0]?.name, branch: `refs/tags/${t.name}` }), 'Tag pushed') },
                { label: 'Delete', danger: true, action: () => repo.exec(() => api.deleteTag(t.name)) }
              ])
            }}
          >
            <span className="faint">⌂</span>
            <span className="ellipsis">{t.name}</span>
          </div>
        ))}
      </Section>

      <Section title="Stashes" count={stashes.length} defaultOpen={stashes.length > 0}>
        {stashes.map((s) => (
          <div
            key={s.ref}
            className="sb-item"
            title={s.message}
            onContextMenu={(e) => {
              e.preventDefault()
              ui.menu(e, [
                { label: 'Pop', action: () => repo.exec(() => api.stashApply(s.ref, true)) },
                { label: 'Apply', action: () => repo.exec(() => api.stashApply(s.ref, false)) },
                { separator: true, label: '' },
                { label: 'Drop', danger: true, action: () => repo.exec(() => api.stashDrop(s.ref)) }
              ])
            }}
            onDoubleClick={() => repo.exec(() => api.stashApply(s.ref, true))}
          >
            <span className="faint">≡</span>
            <span className="ellipsis">{s.message}</span>
          </div>
        ))}
      </Section>
    </div>
  )
}

const SUB_STATE: Record<string, { cls: string; label: string }> = {
  ok: { cls: 'ok', label: 'up to date' },
  modified: { cls: 'warn', label: 'checked out at a different commit' },
  uninitialized: { cls: 'off', label: 'not initialized' },
  conflict: { cls: 'fail', label: 'conflict' }
}

function SubmoduleSection() {
  const repo = useRepo()
  const ui = useUi()
  const api = useApi()
  const subs = repo.submodules
  const open = async (path: string) => repo.openRepo(await api.submodulePath(path))
  const add = () =>
    repo.openPalette(
      input('Repository URL or local path', (url) => {
        const name = url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:\\]/).pop() || 'module'
        return input('Path inside this repository', (path) => { repo.exec(() => api.submoduleAdd(url, path), `Added submodule ${path}`) }, {
          value: name,
          title: name,
          suggestions: [{ value: name }, { value: `vendor/${name}` }, { value: `libs/${name}` }]
        })
      }, { title: 'Add Submodule' })
    )
  return (
    <Section title="Submodules" count={subs.length} defaultOpen={subs.length > 0}>
      {subs.length === 0 && (
        <div className="sb-item faint" onClick={add} title="git submodule add">
          <span>+</span>
          <span>Add submodule…</span>
        </div>
      )}
      {subs.map((s) => {
        const st = SUB_STATE[s.state]
        return (
          <div
            key={s.path}
            className="sb-item"
            style={{ paddingLeft: 22 + (s.depth ?? 0) * 12 }}
            title={`${s.path}\n${s.url}\n${st.label}${s.describe ? ` (${s.describe})` : ''}`}
            onDoubleClick={() => (s.state === 'uninitialized' ? repo.exec(() => api.submoduleUpdate([s.path], { init: true })) : open(s.path))}
            onContextMenu={(e) => {
              e.preventDefault()
              ui.menu(e, [
                { label: 'Open submodule', disabled: s.state === 'uninitialized', action: () => open(s.path) },
                { label: s.state === 'uninitialized' ? 'Initialize & update' : 'Update to recorded commit', action: () => repo.exec(() => api.submoduleUpdate([s.path], { init: true }), 'Submodule updated') },
                { label: 'Update to latest remote', action: () => repo.exec(() => api.submoduleUpdate([s.path], { init: true, remote: true }), 'Submodule updated') },
                { separator: true, label: '' },
                { label: 'Copy path', action: () => navigator.clipboard.writeText(s.path) },
                { label: 'Copy URL', action: () => navigator.clipboard.writeText(s.url) },
                { separator: true, label: '' },
                {
                  label: 'Deinitialize…',
                  danger: true,
                  disabled: s.state === 'uninitialized',
                  action: async () => {
                    const r = await ui.ask({ title: `Deinitialize ${s.path}?`, message: 'Removes the checked-out submodule files. Uncommitted changes inside it are lost.', confirmLabel: 'Deinitialize', danger: true })
                    if (r) repo.exec(() => api.submoduleDeinit(s.path))
                  }
                }
              ])
            }}
          >
            <span className={`dot ${st.cls}`} />
            <span className="ellipsis">{(s.depth ?? 0) > 0 ? s.path.split('/').pop() : s.path}</span>
            <span className="ab">{s.sha.slice(0, 7)}</span>
          </div>
        )
      })}
    </Section>
  )
}
