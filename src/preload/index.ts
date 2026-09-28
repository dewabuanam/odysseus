import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ody', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke('ody:invoke', method, args),
  repo: (root: string, method: string, ...args: unknown[]) => ipcRenderer.invoke('ody:repo', root, method, args),
  on: (listener: (channel: string, payload: unknown) => void) => {
    const handler = (_e: unknown, channel: string, payload: unknown) => listener(channel, payload)
    ipcRenderer.on('ody:event', handler)
    return () => ipcRenderer.removeListener('ody:event', handler)
  }
})
