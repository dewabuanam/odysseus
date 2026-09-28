import { useEffect, useState } from 'react'
import { useApi } from '../api'
import { useRepo } from '../repoContext'

interface Line {
  text: string
  kind: 'normal' | 'marker' | 'ours' | 'base' | 'theirs'
  no: number
}

/** Splits a conflicted file into ours / base / theirs regions using the conflict markers. */
function classify(content: string): { lines: Line[]; blocks: number } {
  let region: Line['kind'] = 'normal'
  let blocks = 0
  const lines = content.split('\n').map((text, i): Line => {
    if (text.startsWith('<<<<<<<')) {
      region = 'ours'
      blocks++
      return { text, kind: 'marker', no: i + 1 }
    }
    if (text.startsWith('|||||||') && region === 'ours') {
      region = 'base'
      return { text, kind: 'marker', no: i + 1 }
    }
    if (text.startsWith('=======') && (region === 'ours' || region === 'base')) {
      region = 'theirs'
      return { text, kind: 'marker', no: i + 1 }
    }
    if (text.startsWith('>>>>>>>') && region === 'theirs') {
      region = 'normal'
      return { text, kind: 'marker', no: i + 1 }
    }
    return { text, kind: region, no: i + 1 }
  })
  return { lines, blocks }
}

/**
 * Conflicted file: shows the working copy with conflict regions marked, and resolves by taking
 * one side wholesale, or by marking the file resolved after editing it elsewhere.
 */
export function ConflictView({ path }: { path: string }) {
  const api = useApi()
  const repo = useRepo()
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.conflictContent(path).then((c) => !cancelled && setContent(c))
    return () => {
      cancelled = true
    }
  }, [api, path, repo.status])

  if (content === null) return <div className="diff"><div className="diff-empty">Loading…</div></div>
  const { lines, blocks } = classify(content)

  return (
    <div className="diff conflict">
      <div className="hunk-head">
        <span className="grow">
          {blocks > 0
            ? `${blocks} conflict${blocks === 1 ? '' : 's'}: take a side with the buttons above, or edit the file and mark it resolved`
            : 'No conflict markers left: mark the file resolved'}
        </span>
      </div>
      {lines.slice(0, 3000).map((l) => (
        <div key={l.no} className={`dl cf-${l.kind}`}>
          <span className="no">{l.no}</span>
          <span className="code">{l.text || ' '}</span>
        </div>
      ))}
    </div>
  )
}
