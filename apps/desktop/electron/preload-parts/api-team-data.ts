import { ipcRenderer } from 'electron'

export const teamDataApi = {
  atlasCreateTeam: (name: string) => ipcRenderer.invoke('atlas:createTeam', name),
  atlasExportTeam: (teamId: string) => ipcRenderer.invoke('atlas:exportTeam', teamId),
  atlasUpdateTeam: (teamId: string, input: { name: string }) =>
    ipcRenderer.invoke('atlas:updateTeam', teamId, input),
}
