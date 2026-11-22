export const vaultApi = {
  vaultStatus: () => window.api.vaultStatus(),
  vaultEnroll: (name?: string) => window.api.vaultEnroll(name),
  vaultApprove: (deviceId: string) => window.api.vaultApprove(deviceId),
  vaultRemoveDevice: (deviceId: string) => window.api.vaultRemoveDevice(deviceId),
  vaultItems: () => window.api.vaultItems(),
  vaultGet: (name: string) => window.api.vaultGet(name),
  vaultSet: (name: string, value: string) => window.api.vaultSet(name, value),
  vaultDelete: (name: string) => window.api.vaultDelete(name),
}
