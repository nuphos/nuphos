import { ipcRenderer } from 'electron'

import type { LocalTerminalEvent, TerminalTarget } from '../../src/api/local-terminal-types'

export const localTerminalApi = {
  localTerminalProcesses: () => ipcRenderer.invoke('local-terminal:processes'),
  localTerminalStart: (id: string, cols: number, rows: number, target?: TerminalTarget) =>
    ipcRenderer.invoke('local-terminal:start', id, cols, rows, target),
  localTerminalReplay: (id: string) => ipcRenderer.invoke('local-terminal:replay', id),
  localTerminalInput: (id: string, data: string) =>
    ipcRenderer.invoke('local-terminal:input', id, data),
  localTerminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('local-terminal:resize', id, cols, rows),
  localTerminalClose: (id: string) => ipcRenderer.invoke('local-terminal:close', id),
  onLocalTerminalEvent: (callback: (event: LocalTerminalEvent) => void) => {
    const handler = (_event: unknown, payload: LocalTerminalEvent) => callback(payload)

    ipcRenderer.on('local-terminal:event', handler)

    return () => ipcRenderer.off('local-terminal:event', handler)
  },
}
