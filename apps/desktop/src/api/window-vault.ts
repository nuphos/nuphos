import type { TeamVaultStatus, VaultDevice, VaultItemSummary, VaultStatus } from '../types/vault'

export type WindowVaultApi = {
  vaultStatus(): Promise<VaultStatus>
  vaultEnroll(): Promise<VaultStatus>
  vaultApprove(deviceId: string, fingerprint: string): Promise<void>
  vaultAddComputer(deviceId: string, teamId: string): Promise<VaultDevice>
  vaultRemoveDevice(deviceId: string): Promise<void>
  vaultItems(teamId?: string): Promise<VaultItemSummary[]>
  vaultGet(name: string, teamId?: string): Promise<string>
  vaultSet(name: string, value: string, teamId?: string): Promise<void>
  vaultDelete(name: string, teamId?: string): Promise<void>
  vaultTeamStatus(teamId: string): Promise<TeamVaultStatus>
  vaultAddTeamDevice(teamId: string, deviceId: string, fingerprint: string): Promise<void>
  vaultRemoveTeamDevice(teamId: string, deviceId: string): Promise<void>
}
