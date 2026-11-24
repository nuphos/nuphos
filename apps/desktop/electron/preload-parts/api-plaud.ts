import type { BindingShare } from '../../src/lib/bindingShare'
import { ipcRenderer } from 'electron'

export const plaudApi = {
  atlasListPlaudAccounts: (teamId: string) => ipcRenderer.invoke('atlas:listPlaudAccounts', teamId),
  atlasStartPlaudOAuth: (teamId: string, share?: BindingShare) =>
    ipcRenderer.invoke('atlas:startPlaudOAuth', teamId, share),
  atlasCancelPlaudOAuth: (teamId: string) => ipcRenderer.invoke('atlas:cancelPlaudOAuth', teamId),
  atlasUnbindPlaud: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:unbindPlaud', teamId, bindingId),
  atlasGetPlaudAccountAccess: (teamId: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:getPlaudAccountAccess', teamId, bindingId),
  atlasUpdatePlaudAccountAccess: (teamId: string, bindingId: string, access: unknown) =>
    ipcRenderer.invoke('atlas:updatePlaudAccountAccess', teamId, bindingId, access),
}
