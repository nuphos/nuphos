import { app, BrowserWindow, Menu } from 'electron'

import { t } from './i18n.ts'
import { createWindow, dispatchAppShortcut } from './windows'
import { zoom } from './zoom'

import type { ZoomStep } from './zoom'
import type { MenuItemConstructorOptions } from 'electron'

// Not the zoomIn / zoomOut roles: those zoom whichever webContents has focus,
// often a <webview> pane rather than the app (see zoom.ts).
const zoomItem = (label: string, accelerator: string, step: ZoomStep) => ({
  label,
  accelerator,
  click: () => {
    const win = BrowserWindow.getFocusedWindow()

    if (win) zoom(win.webContents, step)
  },
})

/** Built again when the app's language changes (i18n-electron.ts). */
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
              { role: 'about' as const, label: t('About {app}', { app: app.name }) },
              {
                label: t('Check for Updates…'),
                click: () => dispatchAppShortcut('open-updates'),
              },
              { type: 'separator' as const },
              {
                label: t('Settings…'),
                accelerator: 'CommandOrControl+,',
                click: () => dispatchAppShortcut('open-settings'),
              },
              { type: 'separator' as const },
              { role: 'hide' as const, label: t('Hide {app}', { app: app.name }) },
              { role: 'hideOthers' as const, label: t('Hide Others') },
              { role: 'unhide' as const, label: t('Show All') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: t('Quit {app}', { app: app.name }) },
            ],
          },
        ]
      : []),
    {
      label: t('File'),
      submenu: [
        {
          label: t('Search Agents'),
          accelerator: 'CommandOrControl+K',
          click: () => dispatchAppShortcut('search-sessions'),
        },
        {
          label: t('New Task'),
          accelerator: 'CommandOrControl+N',
          click: () => dispatchAppShortcut('new-chat'),
        },
        {
          label: t('New Window'),
          accelerator: 'CommandOrControl+Shift+N',
          click: () => createWindow(null),
        },
        {
          label: t('New Tab'),
          accelerator: 'CommandOrControl+T',
          click: () => dispatchAppShortcut('new-tab'),
        },
        {
          label: t('Close Tab'),
          accelerator: 'CommandOrControl+W',
          click: () => dispatchAppShortcut('close-tab'),
        },
      ],
    },
    {
      label: t('Edit'),
      submenu: [
        { role: 'undo', label: t('Undo') },
        { role: 'redo', label: t('Redo') },
        { type: 'separator' },
        { role: 'cut', label: t('Cut') },
        { role: 'copy', label: t('Copy') },
        { role: 'paste', label: t('Paste') },
        { role: 'selectAll', label: t('Select All') },
      ],
    },
    {
      label: t('View'),
      submenu: [
        { role: 'reload', label: t('Reload') },
        { role: 'toggleDevTools', label: t('Toggle Developer Tools') },
        { type: 'separator' },
        zoomItem(t('Actual Size'), 'CommandOrControl+0', 'reset'),
        zoomItem(t('Zoom In'), 'CommandOrControl+Plus', 'in'),
        zoomItem(t('Zoom Out'), 'CommandOrControl+-', 'out'),
        { type: 'separator' },
        {
          label: t('Toggle Sidebar'),
          accelerator: 'CommandOrControl+B',
          click: () => dispatchAppShortcut('toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Toggle Full Screen') },
      ],
    },
    {
      label: t('Window'),
      submenu: [
        { role: 'minimize', label: t('Minimize') },
        { role: 'zoom', label: t('Zoom') },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: t('Bring All to Front') },
            ]
          : [{ role: 'close' as const, label: t('Close Window') }]),
      ],
    },
    {
      label: t('Help'),
      role: 'help',
      submenu: [
        {
          label: t('Keyboard Shortcuts'),
          accelerator: 'CommandOrControl+/',
          click: () => dispatchAppShortcut('shortcuts-help'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
