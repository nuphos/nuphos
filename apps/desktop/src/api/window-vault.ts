import type { VaultItemSummary, VaultStatus } from '../types/vault'

export type WindowVaultApi = {
  vaultStatus(): Promise<VaultStatus>
  vaultEnroll(name?: string): Promise<VaultStatus>
  vaultApprove(deviceId: string): Promise<void>
  vaultRemoveDevice(deviceId: string): Promise<void>
  vaultItems(): Promise<VaultItemSummary[]>
  vaultGet(name: string): Promise<string>
  vaultSet(name: string, value: string): Promise<void>
  vaultDelete(name: string): Promise<void>
}
