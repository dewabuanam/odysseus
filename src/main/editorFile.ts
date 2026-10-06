import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { EditorFile } from '@shared/types'

/** Files bigger than this would be slow in a plain text box; they are refused. */
const MAX_BYTES = 20 * 1024 * 1024

export type PathKind = 'file' | 'dir' | null

export function pathKind(p: string): PathKind {
  try {
    const s = statSync(p)
    return s.isDirectory() ? 'dir' : s.isFile() ? 'file' : null
  } catch {
    return null
  }
}

/** Reads a text file for the editor: `\n` line breaks inside, its own line endings and BOM noted. */
export function readEditorFile(path: string): EditorFile {
  const st = statSync(path)
  if (!st.isFile()) throw new Error(`${path} is not a file`)
  if (st.size > MAX_BYTES) throw new Error(`${basename(path)} is ${(st.size / 1048576).toFixed(1)} MB, too big to edit here`)
  const buf = readFileSync(path)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${basename(path)} looks like a binary file`)
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  const text = buf.toString('utf8', bom ? 3 : 0)
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return { path, text: text.replace(/\r\n/g, '\n'), eol: crlf > lf ? 'CRLF' : 'LF', bom, mtimeMs: st.mtimeMs }
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif'
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Reads a local image as a data URL, for a markdown preview (the page can't load file:// URLs). */
export function readImageDataUrl(path: string): string | null {
  const type = IMAGE_TYPES[path.toLowerCase().split('.').pop() ?? '']
  if (!type) return null
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return null
    return `data:${type};base64,${readFileSync(path).toString('base64')}`
  } catch {
    return null
  }
}
