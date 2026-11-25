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
  vaultSet: (name: string, value: string, deviceIds: string[]) =>
    window.api.vaultSet(name, value, deviceIds),
  vaultShare: (name: string, deviceIds: string[]) => window.api.vaultShare(name, deviceIds),
  vaultDelete: (name: string) => window.api.vaultDelete(name),
}
