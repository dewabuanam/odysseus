import type {
  Branch,
  Commit,
  DiffHunk,
  DiffLine,
  FileChange,
  FileDiff,
  FileStatusCode,
  GraphEdge,
  GraphRow,
  RefLabel,
  WorkingStatus
} from '@shared/types'

// ------------------------------------------------------------------ status

/** Parses `git status --porcelain=v2 --branch -z --untracked-files=all`. */
export function parseStatus(out: string): Omit<WorkingStatus, 'operation'> {
  const status: Omit<WorkingStatus, 'operation'> = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    staged: [],
    unstaged: [],
    conflicted: []
  }
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t) continue
    if (t.startsWith('# branch.head ')) {
      const head = t.slice(14)
      status.detached = head === '(detached)'
      status.branch = status.detached ? null : head
    } else if (t.startsWith('# branch.upstream ')) {
      status.upstream = t.slice(18)
    } else if (t.startsWith('# branch.ab ')) {
      const m = t.match(/\+(\d+) -(\d+)/)
      if (m) {
        status.ahead = Number(m[1])
        status.behind = Number(m[2])
      }
    } else if (t.startsWith('1 ') || t.startsWith('2 ')) {
      const renamed = t[0] === '2'
      const parts = t.split(' ')
      const xy = parts[1]
      const path = parts.slice(renamed ? 9 : 8).join(' ')
      const oldPath = renamed ? tokens[++i] : undefined
      const x = xy[0]
      const y = xy[1]
      // <sub> field: "N..." for files, "S<c><m><u>" for submodules
      // (c: commit changed, m: tracked changes inside, u: untracked files inside).
      const sub = parts[2]
      const isSub = sub?.startsWith('S')
      const subState = isSub
        ? [sub[1] === 'C' && 'new commits', sub[2] === 'M' && 'modified content', sub[3] === 'U' && 'untracked content'].filter(Boolean).join(', ')
        : undefined
      const extra = isSub ? { submodule: true, submoduleState: subState } : {}
      if (x !== '.') status.staged.push({ path, oldPath, status: normalize(x), ...extra })
      if (y !== '.') status.unstaged.push({ path, status: normalize(y), ...extra })
    } else if (t.startsWith('u ')) {
      const parts = t.split(' ')
      status.conflicted.push({ path: parts.slice(10).join(' '), status: 'U' })
    } else if (t.startsWith('? ')) {
      status.unstaged.push({ path: t.slice(2), status: '?' })
    }
  }
  return status
}

function normalize(c: string): FileStatusCode {
  if ('MADRCUT?'.includes(c)) return c as FileStatusCode
  return 'M'
}

/** Parses `--name-status -z` output. */
export function parseNameStatus(out: string): FileChange[] {
  const tokens = out.split('\0').filter((t, i, a) => t !== '' || i < a.length - 1)
  const files: FileChange[] = []
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]
    if (!code) continue
    const s = code[0] as FileStatusCode
    if (s === 'R' || s === 'C') {
      files.push({ status: s, oldPath: tokens[i + 1], path: tokens[i + 2] })
      i += 2
    } else {
      files.push({ status: normalize(s), path: tokens[i + 1] })
      i += 1
    }
  }
  return files
}

// ------------------------------------------------------------------ log

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%D'].join('%x1f') + '%x1e'

export function parseLog(out: string): Commit[] {
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, author, email, date, subject, refs] = record.split('\x1f')
      return {
        sha,
        parents: parents ? parents.split(' ') : [],
        author,
        email,
        date: Number(date) * 1000,
        subject,
        refs: parseRefs(refs ?? '')
      }
    })
}

function parseRefs(d: string): RefLabel[] {
  const labels: RefLabel[] = []
  for (const raw of d.split(', ').map((s) => s.trim()).filter(Boolean)) {
    if (raw.startsWith('HEAD -> ')) {
      labels.push({ name: 'HEAD', type: 'head' })
      labels.push({ name: raw.slice(8), type: 'branch' })
    } else if (raw === 'HEAD') {
      labels.push({ name: 'HEAD', type: 'head' })
    } else if (raw.startsWith('tag: ')) {
      labels.push({ name: raw.slice(5), type: 'tag' })
    } else if (raw.includes('/') && !raw.startsWith('refs/')) {
      // Heuristic: remote refs look like origin/main. Local branches with slashes are
      // corrected by the caller using the real branch list.
      labels.push({ name: raw, type: 'remote' })
    } else {
      labels.push({ name: raw, type: 'branch' })
    }
  }
  return labels
}

// ------------------------------------------------------------------ graph

/**
 * Assigns each commit (in topo order) a lane and computes the edges drawn in the top and
 * bottom halves of its row. Classic "lane reservation" layout used by most Git GUIs.
 */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const laneColors: number[] = []
  let nextColor = 0
  const rows: GraphRow[] = []

  const alloc = (sha: string): number => {
    let idx = lanes.indexOf(null)
    if (idx === -1) {
      idx = lanes.length
      lanes.push(null)
    }
    lanes[idx] = sha
    laneColors[idx] = nextColor++ % 8
    return idx
  }

  for (const c of commits) {
    const top: GraphEdge[] = []
    const matching: number[] = []
    lanes.forEach((s, i) => s === c.sha && matching.push(i))

    let node: number
    if (matching.length === 0) node = alloc(c.sha)
    else node = matching[0]
    const color = laneColors[node]

    lanes.forEach((s, i) => {
      if (s === null) return
      if (s === c.sha) {
        if (matching.length > 0) top.push({ fromLane: i, toLane: node, color: laneColors[i] })
      } else {
        top.push({ fromLane: i, toLane: i, color: laneColors[i] })
      }
    })
    for (const i of matching) if (i !== node) lanes[i] = null

    const bottom: GraphEdge[] = []
    lanes[node] = c.parents[0] ?? null
    const mergeTargets = new Set<number>()
    for (const p of c.parents.slice(1)) {
      let target = lanes.indexOf(p)
      if (target === -1) target = alloc(p)
      mergeTargets.add(target)
      bottom.push({ fromLane: node, toLane: target, color: laneColors[target] })
    }
    lanes.forEach((s, i) => {
      if (s === null) return
      if (mergeTargets.has(i) && i !== node && !top.some((e) => e.toLane === i)) return
      bottom.push({ fromLane: i, toLane: i, color: laneColors[i] })
    })

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()

    const maxLane = Math.max(node, ...top.flatMap((e) => [e.fromLane, e.toLane]), ...bottom.flatMap((e) => [e.fromLane, e.toLane]))
    rows.push({ lane: node, color, top, bottom, width: maxLane + 1 })
  }
  return rows
}

// ------------------------------------------------------------------ branches

export const BRANCH_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)'
].join('%1f')

export function parseBranches(out: string): Branch[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [fullRef, name, sha, head, upstream, track] = line.split('\x1f')
      const ahead = Number(track?.match(/ahead (\d+)/)?.[1] ?? 0)
      const behind = Number(track?.match(/behind (\d+)/)?.[1] ?? 0)
      return {
        name,
        fullRef,
        sha,
        remote: fullRef.startsWith('refs/remotes/'),
        current: head === '*',
        upstream: upstream || undefined,
        ahead,
        behind
      }
    })
    .filter((b) => !b.fullRef.endsWith('/HEAD'))
}

// ------------------------------------------------------------------ diff

export function parseDiff(out: string): FileDiff[] {
  const files: FileDiff[] = []
  const lines = out.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  let file: FileDiff | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('diff --cc ')) {
      const m = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/)
      file = {
        path: m ? m[2] : line.slice(11),
        oldPath: m && m[1] !== m[2] ? m[1] : undefined,
        binary: false,
        isNew: false,
        isDeleted: false,
        header: [line],
        hunks: []
      }
      hunk = null
      files.push(file)
      continue
    }
    if (!file) continue
    if (!hunk) {
      if (line.startsWith('@@')) {
        // fallthrough to hunk handling below
      } else {
        file.header.push(line)
        if (line.startsWith('new file mode')) file.isNew = true
        if (line.startsWith('deleted file mode')) file.isDeleted = true
        if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true
        if (line.startsWith('+++ ') && line !== '+++ /dev/null') {
          const p = line.slice(4).replace(/^"?b\//, '').replace(/"$/, '')
          file.path = p
        }
        continue
      }
    }
    const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (hm) {
      hunk = {
        header: line,
        oldStart: Number(hm[1]),
        oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: Number(hm[3]),
        newLines: hm[4] === undefined ? 1 : Number(hm[4]),
        lines: []
      }
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue
    const c = line[0]
    let dl: DiffLine
    if (c === '+') dl = { type: 'add', content: line.slice(1), newNo: newNo++ }
    else if (c === '-') dl = { type: 'del', content: line.slice(1), oldNo: oldNo++ }
    else if (c === '\\') dl = { type: 'meta', content: line }
    else dl = { type: 'context', content: line.slice(1), oldNo: oldNo++, newNo: newNo++ }
    hunk.lines.push(dl)
  }
  return files
}

/**
 * Builds a patch containing a single hunk (optionally only some of its lines) suitable for
 * `git apply --cached [--reverse]`.
 *
 * Forward (staging): unselected additions are dropped, unselected deletions become context.
 * Reverse (unstaging / discarding): unselected additions become context, unselected
 * deletions are dropped.
 */
export function buildPatch(
  file: FileDiff,
  hunkIndex: number,
  selected: number[] | null,
  reverse: boolean
): string {
  const hunk = file.hunks[hunkIndex]
  const sel = selected ? new Set(selected) : null
  const out: string[] = []
  let oldCount = 0
  let newCount = 0
  let lastKept = true
  hunk.lines.forEach((l, i) => {
    const isSel = !sel || sel.has(i)
    if (l.type === 'meta') {
      if (lastKept) out.push(l.content)
      return
    }
    if (l.type === 'context' || isSel) {
      out.push((l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.content)
      if (l.type !== 'add') oldCount++
      if (l.type !== 'del') newCount++
      lastKept = true
      return
    }
    // unselected change line
    const toContext = reverse ? l.type === 'add' : l.type === 'del'
    if (toContext) {
      out.push(' ' + l.content)
      oldCount++
      newCount++
      lastKept = true
    } else {
      lastKept = false
    }
  })
  const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`
  const fileHeader = file.header.filter((h) => !h.startsWith('similarity') && !h.startsWith('rename '))
  return [...fileHeader, header, ...out].join('\n') + '\n'
}
