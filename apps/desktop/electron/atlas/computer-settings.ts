import { call } from './client.ts'

/** Turns a computer's automatic updates on or off; whoever manages it may. */
export function setDeviceAutoInstall(deviceId: string, teamId: string, enabled: boolean) {
  const path = `/teams/${encodeURIComponent(teamId)}/computers/${encodeURIComponent(deviceId)}`

  return call<{ enabled: boolean }>('PUT', `${path}/auto-install`, { enabled }, { retry: false })
}
