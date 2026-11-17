import { ipcRenderer } from 'electron'

export const teamDataApi = {
  atlasPreviewTeamImport: () => ipcRenderer.invoke('atlas:previewTeamImport'),
  atlasConfirmTeamImport: (token: string, sourceMember?: string) =>
    ipcRenderer.invoke('atlas:confirmTeamImport', token, sourceMember),
  atlasCreateTeam: (name: string) => ipcRenderer.invoke('atlas:createTeam', name),
  atlasExportTeam: (teamId: string) => ipcRenderer.invoke('atlas:exportTeam', teamId),
  atlasUpdateTeam: (teamId: string, input: { name: string }) =>
    ipcRenderer.invoke('atlas:updateTeam', teamId, input),
}
