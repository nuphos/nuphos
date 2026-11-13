import { ipcRenderer } from 'electron'

export const bindingAccessApi = {
  atlasGetBindingAccess: (teamId: string, collection: string, bindingId: string) =>
    ipcRenderer.invoke('atlas:getBindingAccess', teamId, collection, bindingId),
  atlasUpdateBindingAccess: (
    teamId: string,
    collection: string,
    bindingId: string,
    access: unknown,
  ) => ipcRenderer.invoke('atlas:updateBindingAccess', teamId, collection, bindingId, access),
  atlasSetTeamBindingShareDefault: (teamId: string, share: 'private' | 'team') =>
    ipcRenderer.invoke('atlas:setTeamBindingShareDefault', teamId, share),
}
