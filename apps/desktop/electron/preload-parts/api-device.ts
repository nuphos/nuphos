import { ipcRenderer } from 'electron'

import type { AgentDeviceListOptions } from '../../src/api/device-types.ts'

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
  localRuntimeSetSleepPreferences: (value: unknown) =>
    ipcRenderer.invoke('localRuntime:setSleepPreferences', value),
  localRuntimeGetState: () => ipcRenderer.invoke('localRuntime:getState'),
  onLocalRuntimeState: (cb: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => cb(state)

    ipcRenderer.on('localRuntime:state', handler)

    return () => ipcRenderer.off('localRuntime:state', handler)
  },
  localRuntimeRefresh: () => ipcRenderer.invoke('localRuntime:refresh'),
  localRuntimeUpdateAgent: (provider: string) =>
    ipcRenderer.invoke('localRuntime:updateAgent', provider),
  localRuntimeLatestAgentVersions: () => ipcRenderer.invoke('localRuntime:latestAgentVersions'),
  localRuntimeOpenWorkspace: () => ipcRenderer.invoke('localRuntime:openWorkspace'),
  localRuntimeListActivity: (before?: string) =>
    ipcRenderer.invoke('localRuntime:listActivity', before),
  boxListDevices: (options?: AgentDeviceListOptions) =>
    ipcRenderer.invoke('box:listDevices', options),
  boxCreate: (label?: string, teamId?: string) => ipcRenderer.invoke('box:create', label, teamId),
  boxPause: (deviceId: string) => ipcRenderer.invoke('box:pause', deviceId),
  boxResume: (deviceId: string) => ipcRenderer.invoke('box:resume', deviceId),
  boxDelete: (deviceId: string) => ipcRenderer.invoke('box:delete', deviceId),
  boxDesktop: (deviceId: string) => ipcRenderer.invoke('box:desktop', deviceId),
  boxJoinToken: () => ipcRenderer.invoke('box:join-token'),
  boxRename: (deviceId: string, label: string) => ipcRenderer.invoke('box:rename', deviceId, label),
}
