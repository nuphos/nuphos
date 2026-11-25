import * as vault from '../vault/vault'

export const vaultChannels = {
  'vault:status': () => vault.status(),
  'vault:enroll': () => vault.enroll(),
  'vault:approve': (_e: unknown, deviceId: string, fingerprint: string) =>
    vault.approve(deviceId, fingerprint),
  'vault:addComputer': (_e: unknown, deviceId: string, teamId: string) =>
    vault.addComputer(deviceId, teamId),
  'vault:removeDevice': (_e: unknown, deviceId: string) => vault.removeDevice(deviceId),
  'vault:items': () => vault.items(),
  'vault:get': (_e: unknown, name: string) => vault.getItem(name),
  'vault:set': (_e: unknown, name: string, value: string, deviceIds: string[]) =>
    vault.setItem(name, value, deviceIds),
  'vault:share': (_e: unknown, name: string, deviceIds: string[]) =>
    vault.shareItem(name, deviceIds),
  'vault:delete': (_e: unknown, name: string) => vault.deleteItem(name),
}
