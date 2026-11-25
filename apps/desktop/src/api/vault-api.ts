export const vaultApi = {
  vaultStatus: () => window.api.vaultStatus(),
  vaultEnroll: () => window.api.vaultEnroll(),
  vaultApprove: (deviceId: string, fingerprint: string) =>
    window.api.vaultApprove(deviceId, fingerprint),
  vaultAddComputer: (deviceId: string, teamId: string) =>
    window.api.vaultAddComputer(deviceId, teamId),
  vaultRemoveDevice: (deviceId: string) => window.api.vaultRemoveDevice(deviceId),
  vaultItems: (teamId?: string) => window.api.vaultItems(teamId),
  vaultGet: (name: string, teamId?: string) => window.api.vaultGet(name, teamId),
  vaultSet: (name: string, value: string, teamId?: string) =>
    window.api.vaultSet(name, value, teamId),
  vaultDelete: (name: string, teamId?: string) => window.api.vaultDelete(name, teamId),
  vaultTeamStatus: (teamId: string) => window.api.vaultTeamStatus(teamId),
  vaultAddTeamDevice: (teamId: string, deviceId: string, fingerprint: string) =>
    window.api.vaultAddTeamDevice(teamId, deviceId, fingerprint),
  vaultRemoveTeamDevice: (teamId: string, deviceId: string) =>
    window.api.vaultRemoveTeamDevice(teamId, deviceId),
}
