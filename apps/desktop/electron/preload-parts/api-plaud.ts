import { ipcRenderer } from 'electron'

export const plaudApi = {
  atlasListPlaudAccounts: (teamId: string) => ipcRenderer.invoke('atlas:listPlaudAccounts', teamId),
  atlasStartPlaudOAuth: (teamId: string) => ipcRenderer.invoke('atlas:startPlaudOAuth', teamId),
  atlasCancelPlaudOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelPlaudOAuth', teamId),
  atlasUnbindPlaud: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindPlaud', teamId, bindingId),
  atlasGetPlaudAccountAccess: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:getPlaudAccountAccess', teamId, bindingId),
  atlasUpdatePlaudAccountAccess: (teamId: string, bindingId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updatePlaudAccountAccess', teamId, bindingId, access),
}
