import { app, Menu } from 'electron'

import { checkForUpdatesInteractive } from './updater'
import { createWindow, dispatchAppShortcut } from './windows'

import type { MenuItemConstructorOptions } from 'electron'

export function installApplicationMenu() {
  const isMac = process.platform === 'darwin'

  // Off macOS the window is frameless with no menu bar, so drop the application
  // menu entirely — nothing should render under the custom titlebar. The core
  // accelerators (new window/tab, close tab, tab switching) are wired up in the
  // `before-input-event` handler in createWindow, so they keep working.
  if (!isMac) {
    Menu.setApplicationMenu(null)

    return
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              {
                label: 'Check for Updates…',
                click: () => void checkForUpdatesInteractive(),
              },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: () => dispatchAppShortcut('open-settings'),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CommandOrControl+N',
          click: () => dispatchAppShortcut('new-chat'),
        },
        {
          label: 'New Window',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => createWindow(),
        },
        {
          label: 'New Tab',
          accelerator: 'CommandOrControl+T',
          click: () => dispatchAppShortcut('new-tab'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CommandOrControl+W',
          click: () => dispatchAppShortcut('close-tab'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CommandOrControl+B',
          click: () => dispatchAppShortcut('toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CommandOrControl+/',
          click: () => dispatchAppShortcut('shortcuts-help'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
