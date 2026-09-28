import { useEffect, useState } from 'react'
import type { FileDiff } from '@shared/types'

export type DiffMode = 'unstaged' | 'staged' | 'commit'

interface Props {
  diff: FileDiff | null | undefined
  mode: DiffMode
  loading?: boolean
  onApply?(hunk: number, lines: number[] | null, action: 'stage' | 'unstage' | 'discard'): void
}

/**
 * Renders a unified diff. In working-directory modes each hunk can be staged, unstaged or
 * discarded — whole, or just the lines the user clicked (shift-click selects a range).
 */
export function DiffView({ diff, mode, loading, onApply }: Props) {
  const [sel, setSel] = useState<{ hunk: number; lines: Set<number>; anchor: number } | null>(null)

  useEffect(() => setSel(null), [diff])

  if (loading && !diff) return <div className="diff"><div className="diff-empty">Loading diff…</div></div>
  if (!diff) return <div className="diff"><div className="diff-empty">No changes to show.</div></div>
  if (diff.binary) return <div className="diff"><div className="diff-empty">Binary file</div></div>
  if (diff.hunks.length === 0) {
    return <div className="diff"><div className="diff-empty">{diff.oldPath ? 'File renamed without changes.' : 'Mode change or empty file.'}</div></div>
  }

  const toggle = (hunk: number, line: number, shift: boolean) => {
    const type = diff.hunks[hunk].lines[line].type
    if (mode === 'commit' || (type !== 'add' && type !== 'del')) return
    setSel((prev) => {
      if (!prev || prev.hunk !== hunk) return { hunk, lines: new Set([line]), anchor: line }
      const lines = new Set(prev.lines)
      if (shift) {
        const [a, b] = [Math.min(prev.anchor, line), Math.max(prev.anchor, line)]
        for (let i = a; i <= b; i++) {
          const t = diff.hunks[hunk].lines[i].type
          if (t === 'add' || t === 'del') lines.add(i)
        }
      } else if (lines.has(line)) lines.delete(line)
      else lines.add(line)
      return lines.size ? { hunk, lines, anchor: line } : null
    })
  }

  return (
    <div className="diff">
      {diff.hunks.map((h, hi) => {
        const selected = sel?.hunk === hi ? [...sel.lines].sort((a, b) => a - b) : null
        const what = selected ? `${selected.length} line${selected.length > 1 ? 's' : ''}` : 'hunk'
        return (
          <div key={hi}>
            <div className="hunk-head">
              <span className="grow">{h.header}</span>
              {onApply && mode === 'unstaged' && (
                <>
                  <button className="btn small" onClick={() => onApply(hi, selected, 'discard')}>
                    Discard {what}
                  </button>
                  <button className="btn small" onClick={() => onApply(hi, selected, 'stage')}>
                    Stage {what}
                  </button>
                </>
              )}
              {onApply && mode === 'staged' && (
                <button className="btn small" onClick={() => onApply(hi, selected, 'unstage')}>
                  Unstage {what}
                </button>
              )}
            </div>
            {h.lines.map((l, li) => (
              <div
                key={li}
                className={`dl ${l.type} ${sel?.hunk === hi && sel.lines.has(li) ? 'sel' : ''}`}
                onClick={(e) => toggle(hi, li, e.shiftKey)}
              >
                <span className="no">{l.oldNo ?? ''}</span>
                <span className="no">{l.newNo ?? ''}</span>
                <span className="code">{l.type === 'meta' ? l.content : l.content || ' '}</span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
