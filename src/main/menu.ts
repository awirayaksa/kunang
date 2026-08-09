import { Menu, app, dialog, BrowserWindow, nativeImage } from 'electron'
import { getAppIconPath } from './paths'

/** The mark, sized for a dialog. Undefined rather than a broken image if the
 *  icon is missing, since a dialog is not worth failing over. */
function getBrandIcon() {
  try {
    const image = nativeImage.createFromPath(getAppIconPath())
    if (image.isEmpty()) return undefined
    return image.resize({ width: 64, height: 64, quality: 'best' })
  } catch {
    return undefined
  }
}

// Electron hands menu click handlers a BaseWindow, which has no webContents.
// Narrowing is the honest fix; casting would hide a real null case.
function sendAction(win: Electron.BaseWindow | undefined, action: string) {
  if (win instanceof BrowserWindow) {
    win.webContents.send('menu-action', action)
  }
}

export function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: (_item, win) => sendAction(win, 'open'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: (_item, win) => sendAction(win, 'save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: (_item, win) => sendAction(win, 'save-as'),
        },
        { type: 'separator' },
        {
          label: 'Print',
          accelerator: 'CmdOrCtrl+P',
          click: (_item, win) => sendAction(win, 'print'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, win) => sendAction(win, 'close-tab'),
        },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: (_item, win) => win?.close(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        // Declared here rather than as renderer keydown handlers: Chromium
        // reserves Ctrl+Tab and never delivers it to the page.
        {
          label: 'Next Tab',
          accelerator: 'Control+Tab',
          click: (_item, win) => sendAction(win, 'next-tab'),
        },
        {
          label: 'Previous Tab',
          accelerator: 'Control+Shift+Tab',
          click: (_item, win) => sendAction(win, 'prev-tab'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Edit Mode',
          accelerator: 'CmdOrCtrl+E',
          click: (_item, win) => sendAction(win, 'toggle-edit'),
        },
        {
          label: 'Toggle Outline',
          accelerator: 'CmdOrCtrl+\\',
          click: (_item, win) => sendAction(win, 'toggle-outline'),
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: (_item, win) => sendAction(win, 'zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: (_item, win) => sendAction(win, 'zoom-out'),
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: (_item, win) => sendAction(win, 'zoom-reset'),
        },
        { type: 'separator' },
        {
          label: 'Reload from Disk',
          accelerator: 'F5',
          click: (_item, win) => sendAction(win, 'reload'),
        },
        { type: 'separator' },
        {
          label: 'Cycle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: (_item, win) => sendAction(win, 'cycle-theme'),
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Export HTML...',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: (_item, win) => sendAction(win, 'export'),
        },
        { type: 'separator' },
        {
          label: 'Register as default .md viewer',
          click: async () => {
            const { install } = await import('./install')
            install()
            dialog.showMessageBox({
              type: 'info',
              title: 'kunang',
              message: 'Registered as default Markdown viewer.\n\nDouble-click .md files to open in kunang.',
            })
          },
        },
        {
          label: 'Unregister .md viewer',
          click: async () => {
            const { uninstall } = await import('./install')
            uninstall()
            dialog.showMessageBox({
              type: 'info',
              title: 'kunang',
              message: 'Unregistered as Markdown viewer.',
            })
          },
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About kunang',
          click: () => {
            // Lowercase throughout: BRAND.md is explicit that the name is
            // never capitalised.
            dialog.showMessageBox({
              type: 'none',
              icon: getBrandIcon(),
              title: 'About kunang',
              message: 'kunang',
              detail:
                `Notepad-fast Markdown viewer and editor for Windows\n\n` +
                `Version ${app.getVersion()}\n\n` +
                `Double-click .md → view instantly\n` +
                `Ctrl+E → edit (source + live preview)`,
              buttons: ['Close'],
              noLink: true,
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
