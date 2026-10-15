import {
  boxDesktop,
  boxJoinToken,
  createBox,
  createDeviceAgent,
  deleteBox,
  renameBox,
  listAgentDevices,
  pauseBox,
  resumeBox,
} from '../atlas/boxes.ts'

import type { AgentDeviceListOptions, LocalAgentProvider } from '../../src/api/device-types.ts'

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string')

  return value
}
function agentProvider(value: unknown): LocalAgentProvider {
  if (value !== 'claude-code' && value !== 'codex')
    throw new TypeError('Expected an agent provider')

  return value
}
function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : string(value)
}

export const boxChannels = {
  'box:listDevices': (_e?: unknown, options?: AgentDeviceListOptions) => listAgentDevices(options),
  'box:create': (_e: unknown, label?: unknown, teamId?: unknown) =>
    createBox(optionalString(label), optionalString(teamId)),
  'box:createAgent': (_e: unknown, deviceId: unknown, teamId: unknown, provider: unknown) =>
    createDeviceAgent(string(deviceId), string(teamId), agentProvider(provider)),
  'box:pause': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    pauseBox(string(deviceId), string(teamId)),
  'box:resume': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    resumeBox(string(deviceId), string(teamId)),
  'box:delete': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    deleteBox(string(deviceId), string(teamId)),
  'box:desktop': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    boxDesktop(string(deviceId), string(teamId)),
  'box:join-token': () => boxJoinToken(),
  'box:rename': (_e: unknown, deviceId: unknown, teamId: unknown, label: unknown) =>
    renameBox(string(deviceId), string(teamId), string(label)),
}
