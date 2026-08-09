import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  onLoad: (callback: (payload: { file: string | null; cwd: string; t0: number }) => void) => {
    ipcRenderer.on('load', (_event, payload) => callback(payload))
  },
  onRestoreTabs: (callback: (payload: { paths: string[] }) => void) => {
    ipcRenderer.on('restore-tabs', (_event, payload) => callback(payload))
  },
  onFileChanged: (callback: (payload: { path: string }) => void) => {
    ipcRenderer.on('file-changed', (_event, payload) => callback(payload))
  },
  onFileRemoved: (callback: (payload: { path: string }) => void) => {
    ipcRenderer.on('file-removed', (_event, payload) => callback(payload))
  },
  onFileRenamed: (callback: (payload: { from: string; to: string }) => void) => {
    ipcRenderer.on('file-renamed', (_event, payload) => callback(payload))
  },
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu-action', (_event, action: string) => callback(action))
  },
  readFile: (
    filePath: string,
    force = false,
  ): Promise<{ content: string; encoding: string; bom: boolean; eol: string }> => {
    return ipcRenderer.invoke('read-file', filePath, force)
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
  getTheme: (): Promise<'auto' | 'light' | 'dark'> => {
    return ipcRenderer.invoke('get-theme')
  },
  setTheme: (mode: 'auto' | 'light' | 'dark') => {
    ipcRenderer.send('set-theme', mode)
  },
  setDirty: (count: number, fileName: string) => {
    ipcRenderer.send('set-dirty', count, fileName)
  },
  tabsChanged: (paths: string[]) => {
    ipcRenderer.send('tabs-changed', paths)
  },
  confirmCloseTab: (fileName: string): Promise<number> => {
    return ipcRenderer.invoke('confirm-close-tab', fileName)
  },
  onRequestSave: (callback: () => void) => {
    ipcRenderer.on('request-save', () => callback())
  },
  saveResult: (ok: boolean) => {
    ipcRenderer.send('save-result', ok)
  },
  allowRemote: () => {
    ipcRenderer.send('allow-remote')
  },
  revokeRemote: () => {
    ipcRenderer.send('revoke-remote')
  },
  getCustomCss: (): Promise<string | null> => {
    return ipcRenderer.invoke('get-custom-css')
  },
  // Electron removed File.path; webUtils is the supported replacement, and it
  // only exists in the preload, so a dropped file's real path has to be
  // resolved here.
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  getScroll: (filePath: string): Promise<number> => {
    return ipcRenderer.invoke('get-scroll', filePath)
  },
  setScroll: (filePath: string, y: number) => {
    ipcRenderer.send('set-scroll', filePath, y)
  },
}

contextBridge.exposeInMainWorld('kunang', api)
