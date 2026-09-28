import { useState, type ReactNode } from 'react'
import type { Branch } from '@shared/types'
import { api } from '../api'
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
  const { status, branches, tags, stashes, remotes, hooks } = repo
  const local = branches.filter((b) => !b.remote)
  const current = local.find((b) => b.current)
  const changes = status ? status.staged.length + status.unstaged.length + status.conflicted.length : 0

  const branchMenu = (e: React.MouseEvent, b: Branch) => {
    e.preventDefault()
    const cur = current?.name
    const items = b.remote
      ? [
          { label: `Checkout as local branch`, action: () => repo.exec(() => api.checkoutRemote(b.name)) },
          { label: `Merge ${b.name} into ${cur ?? 'HEAD'}`, action: () => repo.exec(() => api.merge(b.name)), disabled: !cur },
          { label: `Rebase ${cur ?? 'HEAD'} onto ${b.name}`, action: () => repo.exec(() => api.rebase(b.name)), disabled: !cur },
          { separator: true, label: '' },
          { label: 'Copy name', action: () => navigator.clipboard.writeText(b.name) }
        ]
      : [
          { label: 'Checkout', action: () => repo.exec(() => api.checkout(b.name)), disabled: b.current },
          { label: `Merge into ${cur ?? 'HEAD'}`, action: () => repo.exec(() => api.merge(b.name)), disabled: b.current || !cur },
          { label: `Rebase ${cur ?? 'HEAD'} onto ${b.name}`, action: () => repo.exec(() => api.rebase(b.name)), disabled: b.current || !cur },
          {
            label: 'New branch from here…',
            action: async () => {
              const r = await ui.ask({ title: `New branch from ${b.name}`, input: { label: 'Branch name' }, confirmLabel: 'Create' })
              if (r) repo.exec(() => api.createBranch(r.value, b.name))
            }
          },
          {
            label: b.upstream ? 'Push' : 'Push & set upstream',
            action: () => repo.exec(() => api.push({ remote: remotes[0]?.name, branch: b.name, setUpstream: !b.upstream }), 'Pushed')
          },
          { separator: true, label: '' },
          { label: 'Copy name', action: () => navigator.clipboard.writeText(b.name) },
          {
            label: 'Delete…',
            danger: true,
            disabled: b.current,
            action: async () => {
              const r = await ui.ask({ title: `Delete branch ${b.name}?`, checkbox: { label: 'Force delete (even if not merged)' }, confirmLabel: 'Delete', danger: true })
              if (r) repo.exec(() => api.deleteBranch(b.name, r.checked))
            }
          }
        ]
    ui.menu(e, items)
  }

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
            className={`sb-item ${b.current ? 'current' : ''} ${selected === b.sha && view === 'history' ? 'active' : ''}`}
            onClick={() => repo.select(b.sha)}
            onDoubleClick={() => !b.current && repo.exec(() => api.checkout(b.name))}
            onContextMenu={(e) => branchMenu(e, b)}
            title={b.upstream ? `tracking ${b.upstream}` : 'no upstream'}
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
              <div key={b.fullRef} className="sb-item" onClick={() => repo.select(b.sha)} onContextMenu={(e) => branchMenu(e, b)} onDoubleClick={() => repo.exec(() => api.checkoutRemote(b.name))}>
                <span className="faint">⎇</span>
                <span className="ellipsis">{b.name.slice(r.name.length + 1)}</span>
              </div>
            ))}
          </Section>
        )
      })}

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
