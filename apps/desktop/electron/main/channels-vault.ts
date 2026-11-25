import * as team from '../vault/team'
import * as vault from '../vault/vault'

export const vaultChannels = {
  'vault:status': () => vault.status(),
  'vault:enroll': () => vault.enroll(),
  'vault:approve': (_e: unknown, deviceId: string, fingerprint: string) =>
    vault.approve(deviceId, fingerprint),
  'vault:addComputer': (_e: unknown, deviceId: string, teamId: string) =>
    vault.addComputer(deviceId, teamId),
  'vault:removeDevice': (_e: unknown, deviceId: string) => vault.removeDevice(deviceId),
  'vault:items': (_e: unknown, teamId?: string) => vault.items(teamId),
  'vault:get': (_e: unknown, name: string, teamId?: string) => vault.getItem(name, teamId),
  'vault:set': (_e: unknown, name: string, value: string, teamId?: string) =>
    vault.setItem(name, value, teamId),
  'vault:delete': (_e: unknown, name: string, teamId?: string) => vault.deleteItem(name, teamId),
  'vault:teamStatus': (_e: unknown, teamId: string) => team.teamStatus(teamId),
  'vault:addTeamDevice': (_e: unknown, teamId: string, deviceId: string, fingerprint: string) =>
    team.addTeamDevice(teamId, deviceId, fingerprint),
  'vault:removeTeamDevice': (_e: unknown, teamId: string, deviceId: string) =>
    team.removeTeamDevice(teamId, deviceId),
}
