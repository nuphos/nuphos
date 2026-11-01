import { ipcRenderer } from 'electron'

import type { WindowSurface } from '../../src/api/window-shell'

export const windowSessionApi = {
  takeWindowSurface: (): Promise<WindowSurface | null> =>
    ipcRenderer.invoke('window-session:take-surface'),
  reportWindowSurface: (surface: WindowSurface) =>
    ipcRenderer.send('window-session:report-surface', surface),
}
