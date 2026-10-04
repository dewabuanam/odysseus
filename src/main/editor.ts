import { BrowserWindow, dialog, nativeImage, type IpcMainInvokeEvent } from 'electron'
import { existsSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
export { pathKind, readEditorFile } from './editorFile'

interface EditorWin {
  win: BrowserWindow
  path: string
  dirty: boolean
  watcher: FSWatcher | null
  timer: NodeJS.Timeout | null
  /** Our own save: its watch event isn't a change from outside */
  savedAt: number
}

const editors = new Map<number, EditorWin>()
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Writes the editor's text (always `\n` inside) with the file's line endings. */
export function writeEditorFile(e: IpcMainInvokeEvent, path: string, text: string, eol: 'CRLF' | 'LF', bom: boolean): number {
  const ed = editors.get(e.sender.id)
  if (ed) ed.savedAt = Date.now()
  const out = eol === 'CRLF' ? text.replace(/\n/g, '\r\n') : text
  writeFileSync(path, (bom ? '﻿' : '') + out, 'utf8')
  return statSync(path).mtimeMs
}

export function setEditorDirty(e: IpcMainInvokeEvent, dirty: boolean): void {
  const ed = editors.get(e.sender.id)
  if (!ed) return
  ed.dirty = dirty
  ed.win.setTitle(`${dirty ? '● ' : ''}${basename(ed.path)} - Odysseus`)
  ed.win.setDocumentEdited(dirty)
}

/** The editor window switched to another file (opened from inside it). */
export function setEditorPath(e: IpcMainInvokeEvent, path: string): void {
  const ed = editors.get(e.sender.id)
  if (!ed) return
  ed.path = path
  watchFile(ed)
}

function watchFile(ed: EditorWin): void {
  ed.watcher?.close()
  ed.watcher = null
  try {
    ed.watcher = watch(ed.path, () => {
      if (Date.now() - ed.savedAt < 600) return
      if (ed.timer) clearTimeout(ed.timer)
      ed.timer = setTimeout(() => {
        if (!ed.win.isDestroyed()) ed.win.webContents.send('ody:event', 'editorFileChanged', { path: ed.path, exists: existsSync(ed.path) })
      }, 200)
    })
  } catch {
    ed.watcher = null
  }
}

interface Options {
  preload: string
  rendererUrl?: string
  rendererFile: string
  icon?: string
  dark: boolean
}

/**
 * Opens a file in its own editor window: the file as it is on disk now, not a version from
 * history. A file already open in a window just brings that window forward.
 */
export function openEditor(path: string, o: Options): void {
  for (const ed of editors.values()) {
    if (norm(ed.path) === norm(path) && !ed.win.isDestroyed()) {
      if (ed.win.isMinimized()) ed.win.restore()
      ed.win.focus()
      return
    }
  }
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 480,
    minHeight: 320,
    backgroundColor: o.dark ? '#1c1d1e' : '#f6f3ec',
    title: `${basename(path)} - Odysseus`,
    icon: o.icon && existsSync(o.icon) ? nativeImage.createFromPath(o.icon) : undefined,
    show: false,
    titleBarStyle: 'hidden',
    // Native window buttons drawn over our own header, in the theme's colors.
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: o.dark ? '#222324' : '#eeeae0', symbolColor: o.dark ? '#ecebe5' : '#1d1d1d', height: 34 },
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
  })
  const id = win.webContents.id
  const ed: EditorWin = { win, path, dirty: false, watcher: null, timer: null, savedAt: 0 }
  editors.set(id, ed)
  watchFile(ed)
  win.once('ready-to-show', () => win.show())
  win.on('close', (e) => {
    if (!ed.dirty) return
    e.preventDefault()
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Save changes to ${basename(ed.path)}?`,
      detail: 'Your changes are lost if you close without saving.'
    })
    if (r === 0) win.webContents.send('ody:event', 'editorSaveAndClose', null)
    else if (r === 1) {
      ed.dirty = false
      win.close()
    }
  })
  win.on('closed', () => {
    ed.watcher?.close()
    if (ed.timer) clearTimeout(ed.timer)
    editors.delete(id)
  })
  const hash = `editor=${encodeURIComponent(path)}`
  if (o.rendererUrl) win.loadURL(`${o.rendererUrl}#${hash}`)
  else win.loadFile(o.rendererFile, { hash })
}

/** Closes the window an editor call came from (after Save and close). */
export function closeEditor(e: IpcMainInvokeEvent): void {
  const ed = editors.get(e.sender.id)
  if (!ed) return
  ed.dirty = false
  ed.win.close()
}

export async function pickFile(e: IpcMainInvokeEvent, defaultPath?: string): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { properties: ['openFile' as const], title: 'Open file', defaultPath: defaultPath || undefined }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? null : r.filePaths[0]
}

export function editorOptions(dirname: string, icon: string, dark: boolean): Options {
  return {
    preload: join(dirname, '../preload/index.js'),
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFile: join(dirname, '../renderer/index.html'),
    icon,
    dark
  }
}
