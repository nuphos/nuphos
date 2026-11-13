import { ipcRenderer } from 'electron'

export const localSetupApi = {
  localSetupStatus: (teamId: string) => ipcRenderer.invoke('localSetup:status', teamId),
  localSetupSync: (teamId: string) => ipcRenderer.invoke('localSetup:sync', teamId),
  localSetupApproveLinks: (
    teamId: string,
    name: string,
    reviewed: { relPath: string; realPath: string }[],
  ) => ipcRenderer.invoke('localSetup:approveLinks', teamId, name, reviewed),
  localSetupSetAutoSync: (teamId: string, enabled: boolean) =>
    ipcRenderer.invoke('localSetup:setAutoSync', teamId, enabled),
  localSetupSetFolders: (teamId: string, folders: string[]) =>
    ipcRenderer.invoke('localSetup:setFolders', teamId, folders),
  localSetupSources: (teamId: string) => ipcRenderer.invoke('localSetup:sources', teamId),
}
