import * as vault from '../vault/vault'

export const vaultChannels = {
  'vault:status': () => vault.status(),
  'vault:enroll': (_e: unknown, name?: string) => vault.enroll(name),
  'vault:approve': (_e: unknown, deviceId: string) => vault.approve(deviceId),
  'vault:removeDevice': (_e: unknown, deviceId: string) => vault.removeDevice(deviceId),
  'vault:items': () => vault.items(),
  'vault:get': (_e: unknown, name: string) => vault.getItem(name),
  'vault:set': (_e: unknown, name: string, value: string) => vault.setItem(name, value),
  'vault:delete': (_e: unknown, name: string) => vault.deleteItem(name),
}
