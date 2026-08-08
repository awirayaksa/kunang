import { ipcMain, BrowserWindow, dialog } from 'electron'
import { openDocument, saveDocument } from './document'
import { getThemeMode, setThemeMode } from './theme'
import { getState, markDirty, getScrollPosition, setScrollPosition } from './state'
import { readCustomCss } from './paths'

export function registerIpcHandlers() {
  ipcMain.handle('read-file', async (_event, filePath: string, force = false) => {
    return openDocument(filePath, force)
  })

  ipcMain.handle('save-file', async (_event, filePath: string, content: string) => {
    await saveDocument(filePath, content)
  })

  ipcMain.handle('save-file-as', async (event, content: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || !result.filePath) return null

    await saveDocument(result.filePath, content)
    return result.filePath
  })

  ipcMain.handle('open-file-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('get-app-path', () => {
    return process.execPath
  })

  ipcMain.handle('get-theme', () => getThemeMode())

  // Read per call rather than cached, so editing custom.css and pressing F5
  // picks the change up without restarting the resident host.
  ipcMain.handle('get-custom-css', () => readCustomCss())

  ipcMain.on('set-theme', (_event, mode: 'auto' | 'light' | 'dark') => {
    setThemeMode(mode)
    // Persisted so the next window is constructed with a matching
    // backgroundColor — otherwise a dark-theme open flashes white.
    getState().theme = mode
    markDirty()
  })

  ipcMain.handle('get-scroll', (_event, filePath: string) => getScrollPosition(filePath))

  ipcMain.on('set-scroll', (_event, filePath: string, y: number) => {
    setScrollPosition(filePath, y)
  })

  ipcMain.on('paint-done', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isVisible()) {
      win.show()
    }
  })
}
