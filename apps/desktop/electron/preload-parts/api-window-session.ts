import { ipcRenderer } from 'electron'

import type { WindowSurface } from '../../src/api/window-shell'

export const windowSessionApi = {
  takeWindowSurface: (): Promise<WindowSurface | null> =>
    ipcRenderer.invoke('window-session:take-surface'),
  openPageWindow: (url: string) => ipcRenderer.send('window:open-page', url),
  takeWindowPage: (): Promise<string | null> => ipcRenderer.invoke('window:take-page'),
  reportWindowSurface: (surface: WindowSurface) =>
    ipcRenderer.send('window-session:report-surface', surface),
}
