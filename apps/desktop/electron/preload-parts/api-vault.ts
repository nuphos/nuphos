import { ipcRenderer } from 'electron'

import type { VaultItemSummary, VaultStatus } from '../../src/types/vault'

export const vaultApi = {
  vaultStatus: (): Promise<VaultStatus> => ipcRenderer.invoke('vault:status'),
  vaultEnroll: (name?: string): Promise<VaultStatus> => ipcRenderer.invoke('vault:enroll', name),
  vaultApprove: (deviceId: string): Promise<void> => ipcRenderer.invoke('vault:approve', deviceId),
  vaultRemoveDevice: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke('vault:removeDevice', deviceId),
  vaultItems: (): Promise<VaultItemSummary[]> => ipcRenderer.invoke('vault:items'),
  vaultGet: (name: string): Promise<string> => ipcRenderer.invoke('vault:get', name),
  vaultSet: (name: string, value: string): Promise<void> =>
    ipcRenderer.invoke('vault:set', name, value),
  vaultDelete: (name: string): Promise<void> => ipcRenderer.invoke('vault:delete', name),
}
