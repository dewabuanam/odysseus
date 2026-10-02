/** Conflict markers in a working-tree file: parsing, and building the merged result from per-block choices. */

export type ConflictChoice = 'ours' | 'theirs' | 'ours-theirs' | 'theirs-ours' | 'none'

export interface TextPart {
  kind: 'text'
  lines: string[]
}

export interface ConflictPart {
  kind: 'conflict'
  ours: string[]
  base: string[] | null
  theirs: string[]
  oursLabel: string
  theirsLabel: string
  /** The block as written in the file, markers included: what an unresolved block keeps. */
  raw: string[]
}

export type Part = TextPart | ConflictPart

const label = (line: string) => line.replace(/^[<>|=]{7}\s?/, '').trim()

/** Splits a file with conflict markers into plain text and conflict blocks (diff3 base included). */
export function parseConflicts(content: string): Part[] {
  const parts: Part[] = []
  let text: string[] = []
  let block: ConflictPart | null = null
  let region: 'ours' | 'base' | 'theirs' = 'ours'
  for (const line of content.split('\n')) {
    if (!block) {
      if (line.startsWith('<<<<<<<')) {
        if (text.length) parts.push({ kind: 'text', lines: text })
        text = []
        block = { kind: 'conflict', ours: [], base: null, theirs: [], oursLabel: label(line), theirsLabel: '', raw: [line] }
        region = 'ours'
      } else text.push(line)
      continue
    }
    block.raw.push(line)
    if (line.startsWith('|||||||') && region === 'ours') {
      block.base = []
      region = 'base'
    } else if (line.startsWith('=======') && region !== 'theirs') region = 'theirs'
    else if (line.startsWith('>>>>>>>') && region === 'theirs') {
      block.theirsLabel = label(line)
      parts.push(block)
      block = null
    } else (region === 'ours' ? block.ours : region === 'base' ? block.base! : block.theirs).push(line)
  }
  // An unterminated block is not a real conflict: keep it as text.
  if (block) text.push(...block.raw)
  if (text.length || !parts.length) parts.push({ kind: 'text', lines: text })
  return parts
}

function pick(c: ConflictPart, choice: ConflictChoice): string[] {
  switch (choice) {
    case 'ours': return c.ours
    case 'theirs': return c.theirs
    case 'ours-theirs': return [...c.ours, ...c.theirs]
    case 'theirs-ours': return [...c.theirs, ...c.ours]
    default: return c.raw
  }
}

export function mergeResult(parts: Part[], choices: ConflictChoice[]): string {
  let i = 0
  return parts.flatMap((p) => (p.kind === 'text' ? p.lines : pick(p, choices[i++] ?? 'none'))).join('\n')
}
