import type { VaultDevice, VaultItemSummary, VaultStatus } from '../types/vault'

export type WindowVaultApi = {
  vaultStatus(): Promise<VaultStatus>
  vaultEnroll(): Promise<VaultStatus>
  vaultApprove(deviceId: string, fingerprint: string): Promise<void>
  vaultAddComputer(deviceId: string, teamId: string): Promise<VaultDevice>
  vaultRemoveDevice(deviceId: string): Promise<void>
  vaultItems(): Promise<VaultItemSummary[]>
  vaultGet(name: string): Promise<string>
  /** `updatedAt` is the item's as last read, or null for a new one; a changed item is refused. */
  vaultSet(
    name: string,
    value: string,
    deviceIds: string[],
    updatedAt: string | null,
  ): Promise<void>
  vaultShare(name: string, deviceIds: string[], updatedAt: string): Promise<void>
  vaultDelete(name: string): Promise<void>
}
