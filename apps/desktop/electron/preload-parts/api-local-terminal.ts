import { ipcRenderer } from 'electron'

import type {
  DesktopTarget,
  DockTerminalRequest,
  LocalTerminalEvent,
  RuntimeDesktopEvent,
  TerminalTarget,
} from '../../src/api/local-terminal-types'

export const localTerminalApi = {
  acceptDockTerminal: (id: string) => ipcRenderer.invoke('local-terminal:accept-dock', id),
  onDockTerminalRequest: (callback: (request: DockTerminalRequest) => void) => {
    const handler = (_event: unknown, request: DockTerminalRequest) => callback(request)

    ipcRenderer.on('local-terminal:open-dock', handler)

    return () => ipcRenderer.off('local-terminal:open-dock', handler)
  },
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
  runtimeDesktopStart: (id: string, target: DesktopTarget) =>
    ipcRenderer.invoke('runtime-desktop:start', id, target),
  runtimeDesktopInput: (id: string, data: string) =>
    ipcRenderer.invoke('runtime-desktop:input', id, data),
  runtimeDesktopClose: (id: string) => ipcRenderer.invoke('runtime-desktop:close', id),
  onRuntimeDesktopEvent: (callback: (event: RuntimeDesktopEvent) => void) => {
    const handler = (_event: unknown, payload: RuntimeDesktopEvent) => callback(payload)

    ipcRenderer.on('runtime-desktop:event', handler)

    return () => ipcRenderer.off('runtime-desktop:event', handler)
  },
}
