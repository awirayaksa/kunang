import { Menu, app, dialog } from 'electron'

function sendAction(win: Electron.BrowserWindow | undefined, action: string) {
  win?.webContents.send('menu-action', action)
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
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, win) => win?.close(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
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
            dialog.showMessageBox({
              type: 'info',
              title: 'About kunang',
              message: 'kunang — Notepad-fast Markdown viewer for Windows',
              detail: `Version ${app.getVersion()}\n\nDouble-click .md → view instantly\nCtrl+E → edit (source + live preview)`,
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
