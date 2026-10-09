import { ipcRenderer } from 'electron'

export const deviceApi = {
  onWindowFullScreenChanged: (cb: (fullScreen: boolean) => void) => {
    const handler = (_event: unknown, fullScreen: boolean) => cb(fullScreen)

    ipcRenderer.on('app:fullScreenChanged', handler)

    return () => ipcRenderer.off('app:fullScreenChanged', handler)
  },
  deviceGetIdentity: () => ipcRenderer.invoke('device:getIdentity'),
  deviceSetLabel: (label: string) => ipcRenderer.invoke('device:setLabel', label),
  deviceListAudit: (before?: string) => ipcRenderer.invoke('device:listAudit', before),
  localRuntimeStartClaudeLogin: () => ipcRenderer.invoke('localRuntime:startClaudeLogin'),
  localRuntimeStartCodexLogin: () => ipcRenderer.invoke('localRuntime:startCodexLogin'),
  localRuntimeCancelClaudeLogin: () => ipcRenderer.invoke('localRuntime:cancelClaudeLogin'),
  localRuntimeCancelCodexLogin: () => ipcRenderer.invoke('localRuntime:cancelCodexLogin'),
  localRuntimeGetState: () => ipcRenderer.invoke('localRuntime:getState'),
  localAgentSetDefaults: (runtimeId: string, defaults: unknown) =>
    ipcRenderer.invoke('localAgent:setDefaults', runtimeId, defaults),
  onLocalRuntimeState: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => cb(state)

    ipcRenderer.on('localRuntime:state', handler)

    return () => ipcRenderer.off('localRuntime:state', handler)
  },
  localRuntimeRefresh: () => ipcRenderer.invoke('localRuntime:refresh'),
  localRuntimeOpenWorkspace: () => ipcRenderer.invoke('localRuntime:openWorkspace'),
  localRuntimeListActivity: (before?: string) =>
    ipcRenderer.invoke('localRuntime:listActivity', before),
}
