import { ipcRenderer } from 'electron'

// The accounts signed in on this device besides the current one.
export const accountsApi = {
  authAccounts: () => ipcRenderer.invoke('auth:accounts'),
  authSwitch: (key: string) => ipcRenderer.invoke('auth:switch', key),
  authLogoutAll: () => ipcRenderer.invoke('auth:logoutAll'),
  authLoginEndpoint: () => ipcRenderer.invoke('auth:loginEndpoint'),
  authStageLoginEndpoint: (url: string | null) =>
    ipcRenderer.invoke('auth:stageLoginEndpoint', url),
}
