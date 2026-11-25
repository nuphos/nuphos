import { ipcRenderer } from 'electron'

import type {
  TeamVaultStatus,
  VaultDevice,
  VaultItemSummary,
  VaultStatus,
} from '../../src/types/vault'

export const vaultApi = {
  vaultStatus: (): Promise<VaultStatus> => ipcRenderer.invoke('vault:status'),
  vaultEnroll: (): Promise<VaultStatus> => ipcRenderer.invoke('vault:enroll'),
  vaultApprove: (deviceId: string, fingerprint: string): Promise<void> =>
    ipcRenderer.invoke('vault:approve', deviceId, fingerprint),
  vaultAddComputer: (deviceId: string, teamId: string): Promise<VaultDevice> =>
    ipcRenderer.invoke('vault:addComputer', deviceId, teamId),
  vaultRemoveDevice: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke('vault:removeDevice', deviceId),
  vaultItems: (teamId?: string): Promise<VaultItemSummary[]> =>
    ipcRenderer.invoke('vault:items', teamId),
  vaultGet: (name: string, teamId?: string): Promise<string> =>
    ipcRenderer.invoke('vault:get', name, teamId),
  vaultSet: (name: string, value: string, teamId?: string): Promise<void> =>
    ipcRenderer.invoke('vault:set', name, value, teamId),
  vaultDelete: (name: string, teamId?: string): Promise<void> =>
    ipcRenderer.invoke('vault:delete', name, teamId),
  vaultTeamStatus: (teamId: string): Promise<TeamVaultStatus> =>
    ipcRenderer.invoke('vault:teamStatus', teamId),
  vaultAddTeamDevice: (teamId: string, deviceId: string, fingerprint: string): Promise<void> =>
    ipcRenderer.invoke('vault:addTeamDevice', teamId, deviceId, fingerprint),
  vaultRemoveTeamDevice: (teamId: string, deviceId: string): Promise<void> =>
    ipcRenderer.invoke('vault:removeTeamDevice', teamId, deviceId),
}
