import { ipcMain, BrowserWindow, dialog } from 'electron'
import { readFile } from 'fs/promises'
import { openDocument, saveDocument } from './document'

export function registerIpcHandlers() {
  ipcMain.handle('read-file', async (_event, filePath: string) => {
    return openDocument(filePath)
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

  ipcMain.on('paint-done', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isVisible()) {
      win.show()
    }
  })
}
