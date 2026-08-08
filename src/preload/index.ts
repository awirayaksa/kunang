import { contextBridge, ipcRenderer } from 'electron'

const api = {
  onLoad: (callback: (payload: { file: string | null; cwd: string; t0: number }) => void) => {
    ipcRenderer.on('load', (_event, payload) => callback(payload))
  },
  onFileChanged: (callback: (payload: { path: string }) => void) => {
    ipcRenderer.on('file-changed', (_event, payload) => callback(payload))
  },
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action: string) => callback(action))
  },
  readFile: (filePath: string): Promise<{ content: string; encoding: string; bom: boolean; eol: string }> => {
    return ipcRenderer.invoke('read-file', filePath)
  },
  saveFile: (filePath: string, content: string): Promise<void> => {
    return ipcRenderer.invoke('save-file', filePath, content)
  },
  saveFileAs: (content: string): Promise<string | null> => {
    return ipcRenderer.invoke('save-file-as', content)
  },
  openFileDialog: (): Promise<string | null> => {
    return ipcRenderer.invoke('open-file-dialog')
  },
  paintDone: () => {
    ipcRenderer.send('paint-done')
  },
  getAppPath: (): Promise<string> => {
    return ipcRenderer.invoke('get-app-path')
  },
}

contextBridge.exposeInMainWorld('kunang', api)
