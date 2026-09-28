import type { Branch, Commit } from '@shared/types'
import { input, list, options, type CommandDeps, newBranchFlowFor, tagFlowFor } from './commands'
import type { Step } from './palette'
import type { MenuItem } from './ui'

/** Extra capabilities context menus need on top of the palette's command deps. */
export interface MenuDeps extends CommandDeps {
  openPalette(step: Step): void
  hidden: string[]
  setHidden(refs: string[]): void
  /** Show only one ref's history ("Search…"); null restores the full graph */
  searchRef(ref: string | null): void
  headSha: string | null
}

const copy = (d: MenuDeps, text: string) => {
  navigator.clipboard.writeText(text)
  d.toast(`Copied ${text.length > 40 ? text.slice(0, 40) + '…' : text}`)
}

// ------------------------------------------------------------------ steps shared by menus

export function deleteBranchStep(d: MenuDeps, b: Branch): Step {
  return options(`Delete ${b.name}`, [
    { id: 'd', title: 'Delete (only if merged)', cmdline: `git branch -d ${b.name}`, run: () => { d.exec(() => d.api.deleteBranch(b.name, false), `Deleted ${b.name}`) } },
    { id: 'D', title: 'Force delete (even if not merged)', cmdline: `git branch -D ${b.name}`, run: () => { d.exec(() => d.api.deleteBranch(b.name, true), `Deleted ${b.name}`) } }
  ])
}

export function renameBranchStep(d: MenuDeps, b: Branch): Step {
  return input(`Rename ${b.name} to`, (to) => { d.exec(() => d.api.renameBranch(b.name, to.trim().replace(/\s+/g, '-')), `Renamed to ${to}`) }, { value: b.name, title: 'Rename' })
}

export function setUpstreamStep(d: MenuDeps, b: Branch): Step {
  const candidates = d.branches.filter((x) => x.remote)
  const guess = candidates.find((x) => x.name.endsWith('/' + b.name))
  const items = [...(guess ? [guess] : []), ...candidates.filter((x) => x !== guess)]
  return list(
    `Upstream for ${b.name}`,
    items.map((r) => ({
      id: r.fullRef,
      title: r.name,
      cmdline: `git branch --set-upstream-to=${r.name} ${b.name}`,
      detail: r === guess ? 'same name' : undefined,
      run: () => { d.exec(() => d.api.setUpstream(b.name, r.name), `${b.name} now tracks ${r.name}`) }
    })),
    'Set Upstream'
  )
}

function deleteRemoteStep(d: MenuDeps, ref: string): Step {
  return options(`Delete ${ref} on the remote?`, [
    { id: 'yes', title: `Yes, delete ${ref}`, cmdline: `git push ${ref.split('/')[0]} --delete ${ref.split('/').slice(1).join('/')}`, run: () => { d.exec(() => d.api.deleteRemoteBranch(ref), `Deleted ${ref}`) } },
    { id: 'no', title: 'Cancel', cmdline: '', run: () => undefined }
  ])
}

function rewordStep(d: MenuDeps, c: Commit): Step {
  return input(
    `New message for ${c.sha.slice(0, 7)}`,
    (msg) => { d.exec(() => d.api.rewordCommit(c.sha, msg), 'Commit message updated') },
    { value: c.subject, title: 'Edit Message' }
  )
}

// ------------------------------------------------------------------ branch menu

/** Menu for a branch (sidebar item or ref badge). */
export function branchMenu(d: MenuDeps, b: Branch): MenuItem[] {
  const cur = d.branches.find((x) => x.current)
  const hiddenNow = d.hidden.includes(b.fullRef)
  const others = d.branches.filter((x) => x.fullRef !== b.fullRef && x.fullRef !== (b.upstream ? `refs/remotes/${b.upstream}` : '')).map((x) => x.fullRef)
  if (b.remote) {
    return [
      { label: `Checkout ${b.name.split('/').slice(1).join('/')}`, action: () => d.exec(() => d.api.checkoutRemote(b.name)) },
      { label: `Delete ${b.name}`, danger: true, action: () => d.openPalette(deleteRemoteStep(d, b.name)) },
      { label: `Copy '${b.name}'`, action: () => copy(d, b.name) },
      { label: hiddenNow ? `Show ${b.name}` : `Hide ${b.name}`, action: () => d.setHidden(hiddenNow ? d.hidden.filter((r) => r !== b.fullRef) : [...d.hidden, b.fullRef]) },
      { label: `Hide All Branches Except ${b.name}`, action: () => d.setHidden(others) },
      { label: 'Search…', action: () => d.searchRef(b.name) },
      { separator: true, label: '' },
      { label: `Merge ${b.name} into ${cur?.name ?? 'HEAD'}`, disabled: !cur, action: () => d.exec(() => d.api.merge(b.name)) },
      { label: `Rebase ${cur?.name ?? 'HEAD'} onto ${b.name}`, disabled: !cur, action: () => d.exec(() => d.api.rebase(b.name)) }
    ]
  }
  return [
    { label: `Checkout ${b.name}`, disabled: b.current, action: () => d.exec(() => d.api.checkout(b.name)) },
    { label: `Delete ${b.name}`, danger: true, disabled: b.current, action: () => d.openPalette(deleteBranchStep(d, b)) },
    { label: `Rename ${b.name}…`, action: () => d.openPalette(renameBranchStep(d, b)) },
    { label: `Copy '${b.name}'`, action: () => copy(d, b.name) },
    { label: hiddenNow ? `Show ${b.name}` : `Hide ${b.name}`, disabled: b.current && !hiddenNow, action: () => d.setHidden(hiddenNow ? d.hidden.filter((r) => r !== b.fullRef) : [...d.hidden, b.fullRef]) },
    { label: `Hide All Branches Except ${b.name}`, action: () => d.setHidden(others) },
    { label: 'Set Upstream…', action: () => d.openPalette(setUpstreamStep(d, b)) },
    { label: 'Unset Upstream', disabled: !b.upstream, action: () => d.exec(() => d.api.unsetUpstream(b.name), `${b.name} no longer tracks a remote branch`) },
    { label: 'Search…', action: () => d.searchRef(b.name) },
    { separator: true, label: '' },
    { label: `Merge ${b.name} into ${cur?.name ?? 'HEAD'}`, disabled: b.current || !cur, action: () => d.exec(() => d.api.merge(b.name)) },
    { label: `Rebase ${cur?.name ?? 'HEAD'} onto ${b.name}`, disabled: b.current || !cur, action: () => d.exec(() => d.api.rebase(b.name)) },
    { label: 'New Branch from Here…', action: () => d.openPalette(newBranchFlowFor(d, b.sha)) },
    {
      label: b.upstream ? `Push ${b.name}` : `Push ${b.name} and Set Upstream`,
      action: () => d.exec(() => d.api.push({ remote: d.remotes[0]?.name, branch: b.name, setUpstream: !b.upstream }), 'Pushed')
    }
  ]
}

// ------------------------------------------------------------------ commit menu

/** Menu for a commit row. Branch sections first (for branches pointing here), then commit actions. */
export function commitMenu(d: MenuDeps, c: Commit): MenuItem[] {
  const short = c.sha.slice(0, 7)
  const cur = d.branches.find((x) => x.current)
  const isHead = d.headSha === c.sha
  const localHere = d.branches.filter((b) => !b.remote && b.sha === c.sha)
  const remoteHere = d.branches.filter((b) => b.remote && b.sha === c.sha)
  const items: MenuItem[] = []

  for (const b of localHere) {
    items.push(
      { label: `Checkout ${b.name}`, disabled: b.current, action: () => d.exec(() => d.api.checkout(b.name)) },
      { label: `Delete ${b.name}`, danger: true, disabled: b.current, action: () => d.openPalette(deleteBranchStep(d, b)) },
      { label: `Rename ${b.name}…`, action: () => d.openPalette(renameBranchStep(d, b)) },
      { label: `Copy '${b.name}'`, action: () => copy(d, b.name) },
      { label: 'Set Upstream…', action: () => d.openPalette(setUpstreamStep(d, b)) },
      { label: 'Unset Upstream', disabled: !b.upstream, action: () => d.exec(() => d.api.unsetUpstream(b.name)) },
      { label: 'Search…', action: () => d.searchRef(b.name) },
      { separator: true, label: '' }
    )
  }
  for (const r of remoteHere) {
    items.push(
      { label: `Delete ${r.name}`, danger: true, action: () => d.openPalette(deleteRemoteStep(d, r.name)) },
      { label: `Copy '${r.name}'`, action: () => copy(d, r.name) }
    )
  }
  if (remoteHere.length) items.push({ separator: true, label: '' })

  items.push(
    { label: 'Checkout Commit', action: () => d.exec(() => d.api.checkout(c.sha)) },
    { label: `Revert ${short}`, action: () => d.exec(() => d.api.revert(c.sha)) },
    { label: `Cherry Pick ${short}`, disabled: isHead, action: () => d.exec(() => d.api.cherryPick(c.sha)) },
    { label: `Copy '${c.sha.slice(0, 8)}…'`, action: () => copy(d, c.sha) },
    { separator: true, label: '' },
    {
      label: 'Create',
      submenu: [
        { label: 'Branch Here…', action: () => d.openPalette(newBranchFlowFor(d, c.sha)) },
        { label: 'Tag Here…', action: () => d.openPalette(tagFlowFor(d, c.sha)) }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Edit Commit Message…', disabled: c.parents.length > 1, action: () => d.openPalette(rewordStep(d, c)) },
        { label: 'Amend with Staged Changes', disabled: !isHead || !d.status?.staged.length, action: async () => d.commitAction({ message: await d.api.lastCommitMessage(), amend: true }) },
        { separator: true, label: '' },
        {
          label: 'Drop Commit…',
          danger: true,
          disabled: c.parents.length > 1,
          action: () =>
            d.openPalette(
              options(`Drop ${short} "${c.subject}"? Its changes are removed from history.`, [
                { id: 'yes', title: `Yes, drop ${short}`, cmdline: `git rebase -i ${short}^ (drop)`, run: () => { d.exec(() => d.api.dropCommit(c.sha), `Dropped ${short}`) } },
                { id: 'no', title: 'Cancel', cmdline: '', run: () => undefined }
              ])
            )
        }
      ]
    },
    {
      label: `Reset ${cur?.name ?? 'HEAD'} to This Commit`,
      disabled: isHead,
      submenu: [
        { label: 'Soft: keep all changes staged', action: () => d.exec(() => d.api.reset(c.sha, 'soft')) },
        { label: 'Mixed: keep changes, unstaged', action: () => d.exec(() => d.api.reset(c.sha, 'mixed')) },
        {
          label: 'Hard: discard all changes…',
          danger: true,
          action: () =>
            d.openPalette(
              options(`Hard reset to ${short}? Uncommitted changes are lost.`, [
                { id: 'yes', title: 'Yes, hard reset', cmdline: `git reset --hard ${short}`, run: () => { d.exec(() => d.api.reset(c.sha, 'hard')) } },
                { id: 'no', title: 'Cancel', cmdline: '', run: () => undefined }
              ])
            )
        }
      ]
    },
    { separator: true, label: '' },
    {
      label: 'Hide All Branches on Commit',
      disabled: !localHere.length && !remoteHere.length,
      action: () => d.setHidden([...d.hidden, ...[...localHere, ...remoteHere].filter((b) => !b.current).map((b) => b.fullRef)])
    },
    { label: 'Show All Hidden Branches', disabled: !d.hidden.length, action: () => d.setHidden([]) }
  )
  return items
}
