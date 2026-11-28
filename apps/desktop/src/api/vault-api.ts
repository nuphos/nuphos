export const vaultApi = {
  vaultStatus: () => window.api.vaultStatus(),
  vaultEnroll: () => window.api.vaultEnroll(),
  vaultApprove: (deviceId: string, fingerprint: string) =>
    window.api.vaultApprove(deviceId, fingerprint),
  vaultAddComputer: (deviceId: string, teamId: string) =>
    window.api.vaultAddComputer(deviceId, teamId),
  vaultRemoveDevice: (deviceId: string) => window.api.vaultRemoveDevice(deviceId),
  vaultItems: () => window.api.vaultItems(),
  vaultGet: (name: string) => window.api.vaultGet(name),
  vaultSet: (name: string, value: string, deviceIds: string[], updatedAt: string | null) =>
    window.api.vaultSet(name, value, deviceIds, updatedAt),
  vaultShare: (name: string, deviceIds: string[], updatedAt: string) =>
    window.api.vaultShare(name, deviceIds, updatedAt),
  vaultDelete: (name: string) => window.api.vaultDelete(name),
}
