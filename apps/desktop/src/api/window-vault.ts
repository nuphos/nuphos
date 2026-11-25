import type { VaultDevice, VaultItemSummary, VaultStatus } from '../types/vault'

export type WindowVaultApi = {
  vaultStatus(): Promise<VaultStatus>
  vaultEnroll(): Promise<VaultStatus>
  vaultApprove(deviceId: string, fingerprint: string): Promise<void>
  vaultAddComputer(deviceId: string, teamId: string): Promise<VaultDevice>
  vaultRemoveDevice(deviceId: string): Promise<void>
  vaultItems(): Promise<VaultItemSummary[]>
  vaultGet(name: string): Promise<string>
  vaultSet(name: string, value: string, deviceIds: string[]): Promise<void>
  vaultShare(name: string, deviceIds: string[]): Promise<void>
  vaultDelete(name: string): Promise<void>
}
