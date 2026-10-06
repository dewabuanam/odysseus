import { createContext, createElement, useContext, useEffect, useState, type ReactNode, type Ref } from 'react'
import type { Block, Inline, ListItem } from '@shared/markdown'
import { api } from '../api'

interface Ctx {
  dir: string
  follow: (href: string) => void
  toggleTask: (line: number) => void
}
const MdCtx = createContext<Ctx>({ dir: '', follow: () => {}, toggleTask: () => {} })

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const DRIVE = /^[a-z]:[\\/]/i
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i

/** A link or image path from the document, resolved against the folder the file is in. */
export function resolvePath(dir: string, rel: string): string {
  let p = rel.replace(/^file:\/\/\/?/i, '').replace(/[?#].*$/, '')
  try {
    p = decodeURIComponent(p)
  } catch {
    // Kept as written.
  }
  const sep = dir.includes('\\') ? '\\' : '/'
  const abs = DRIVE.test(p) || (sep === '/' && p.startsWith('/'))
  const out: string[] = []
  for (const s of (abs ? p : `${dir}/${p}`).split(/[\\/]/)) {
    if (s === '..') {
      if (out.length > 1) out.pop()
    } else if (s !== '.' && (s !== '' || out.length === 0)) out.push(s)
  }
  return out.join(sep)
}

/** Opens a link from the preview: web links in the browser, files in an editor window of their own. */
export async function followLink(href: string, dir: string, box: HTMLElement | null, toast: (m: string) => void) {
  if (href.startsWith('#')) {
    let id = href.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // Kept as written.
    }
    const el = box?.querySelector(`[id="${CSS.escape(id.toLowerCase())}"]`) ?? box?.querySelector(`[id="${CSS.escape(id)}"]`)
    if (el) el.scrollIntoView({ block: 'start' })
    else toast(`No heading #${id} here`)
    return
  }
  if (/^https:\/\//i.test(href)) return api.openUrl(href)
  if (SCHEME.test(href) && !DRIVE.test(href) && !/^file:/i.test(href)) return toast(`Only https links open from here: ${href}`)
  const p = resolvePath(dir, href)
  const kind = await api.pathKind(p)
  if (kind === 'file') return IMAGE.test(p) ? api.openExternal(p) : api.openEditor(p)
  if (kind === 'dir') return api.showInFolder(p)
  toast(`Not found: ${p}`)
}

const images = new Map<string, string | null>()

function MdImage({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const { dir, follow } = useContext(MdCtx)
  const local = !SCHEME.test(src) || DRIVE.test(src) || /^file:/i.test(src)
  const path = local ? resolvePath(dir, src) : ''
  const [url, setUrl] = useState<string | null | undefined>(() => (src.startsWith('data:image/') ? src : local ? images.get(path) : null))

  useEffect(() => {
    if (src.startsWith('data:image/')) return setUrl(src)
    if (!local) return setUrl(null)
    if (images.has(path)) return setUrl(images.get(path))
    let live = true
    api.readImage(path).then(
      (u) => {
        images.set(path, u)
        if (live) setUrl(u)
      },
      () => live && setUrl(null)
    )
    return () => {
      live = false
    }
  }, [src, path, local])

  if (url) return <img src={url} alt={alt} title={title ?? alt} />
  // Pictures from the web aren't fetched; the placeholder opens them in the browser.
  return (
    <a className="md-img-missing" href={src} title={src} onClick={(e) => (e.preventDefault(), follow(src))}>
      {url === undefined ? 'Loading image' : local ? 'Image not found' : 'Web image'}
      {alt ? `: ${alt}` : ''}
    </a>
  )
}

function Inlines({ c }: { c: Inline[] }): ReactNode {
  return c.map((x, i) => {
    if (typeof x === 'string') return x
    switch (x.t) {
      case 'em':
        return <em key={i}><Inlines c={x.c} /></em>
      case 'strong':
        return <strong key={i}><Inlines c={x.c} /></strong>
      case 'del':
        return <del key={i}><Inlines c={x.c} /></del>
      case 'code':
        return <code key={i}>{x.v}</code>
      case 'br':
        return <br key={i} />
      case 'img':
        return <MdImage key={i} src={x.src} alt={x.alt} title={x.title} />
      case 'link':
        return <MdLink key={i} href={x.href} title={x.title} c={x.c} />
    }
  })
}

function MdLink({ href, title, c }: { href: string; title?: string; c: Inline[] }) {
  const { follow } = useContext(MdCtx)
  return (
    <a href={href} title={title ?? href} onClick={(e) => (e.preventDefault(), follow(href))}>
      <Inlines c={c} />
    </a>
  )
}

function Item({ item, tight }: { item: ListItem; tight: boolean }) {
  const { toggleTask } = useContext(MdCtx)
  return (
    <li className={item.task === null ? undefined : 'md-task'}>
      {item.task !== null && (
        <input type="checkbox" checked={item.task} title="Tick in the file" onChange={() => toggleTask(item.line)} />
      )}
      <Blocks c={item.c} tight={tight} />
    </li>
  )
}

const ALERTS: Record<string, string> = { note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }

function Blocks({ c, tight = false, top = false }: { c: Block[]; tight?: boolean; top?: boolean }): ReactNode {
  return c.map((b, i) => {
    // Top-level blocks carry their source line, for scrolling the preview along with the text.
    const at = top ? { 'data-line': b.line } : {}
    switch (b.t) {
      case 'h':
        return createElement(`h${b.level}`, { key: i, id: b.id, ...at }, <Inlines c={b.c} />)
      case 'p':
        return tight ? <Inlines key={i} c={b.c} /> : <p key={i} {...at}><Inlines c={b.c} /></p>
      case 'code':
        return (
          <pre key={i} {...at} data-lang={b.lang || undefined}>
            <code>{b.v}</code>
          </pre>
        )
      case 'quote':
        return (
          <blockquote key={i} {...at} className={b.alert ? `md-alert md-alert-${b.alert}` : undefined}>
            {b.alert && <div className="md-alert-title">{ALERTS[b.alert]}</div>}
            <Blocks c={b.c} />
          </blockquote>
        )
      case 'list': {
        const items = b.items.map((it, k) => <Item key={k} item={it} tight={b.tight} />)
        return b.ordered ? <ol key={i} {...at} start={b.start === 1 ? undefined : b.start}>{items}</ol> : <ul key={i} {...at}>{items}</ul>
      }
      case 'hr':
        return <hr key={i} {...at} />
      case 'table':
        return (
          <div key={i} className="md-table" {...at}>
            <table>
              <thead>
                <tr>{b.head.map((h, k) => <th key={k} style={{ textAlign: b.align[k] ?? undefined }}><Inlines c={h} /></th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, k) => (
                  <tr key={k}>{r.map((d, m) => <td key={m} style={{ textAlign: b.align[m] ?? undefined }}><Inlines c={d} /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    }
  })
}

/** The rendered markdown, in its own scrolling pane beside (or over) the text. */
export function MarkdownPreview({
  doc,
  dir,
  fontSize,
  boxRef,
  follow,
  toggleTask
}: {
  doc: Block[]
  dir: string
  fontSize: number
  boxRef: Ref<HTMLDivElement>
  follow: (href: string) => void
  toggleTask: (line: number) => void
}) {
  return (
    <MdCtx.Provider value={{ dir, follow, toggleTask }}>
      <div ref={boxRef} className="md-preview" style={{ fontSize: fontSize + 1 }}>
        <div className="md-doc">
          {doc.length ? <Blocks c={doc} top /> : <div className="md-empty">Nothing to preview yet</div>}
        </div>
      </div>
    </MdCtx.Provider>
  )
}
