import {
  boxBillingPage,
  boxBillingSummary,
  boxDesktop,
  boxJoinToken,
  openSessionDesktop,
  createBox,
  createDeviceAgent,
  removeDeviceAgent,
  deleteBox,
  removeDevice,
  getBoxUsage,
  getBoxUsageHistory,
  renameBox,
  setBoxAccess,
  renameDeviceAgent,
  listAgentDevices,
  pauseBox,
  resumeBox,
} from '../atlas/boxes.ts'
import {
  decideShareApproval,
  getDeviceShare,
  listShareApprovals,
  ownShareApprovalStatus,
  setDeviceShare,
} from '../atlas/local-share.ts'

import { LOCAL_AGENT_PROVIDERS } from './local-runtime/providers.ts'

import type {
  AgentDeviceListOptions,
  BoxAccess,
  LocalAgentProvider,
  LocalShareInput,
} from '../../src/api/device-types.ts'

function string(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected a string')

  return value
}
function agentProvider(value: unknown): LocalAgentProvider {
  const provider = LOCAL_AGENT_PROVIDERS.find((known) => known === value)

  if (!provider) throw new TypeError('Expected a runtime provider')

  return provider
}
function boxAccess(value: unknown): BoxAccess {
  const access = value as Partial<BoxAccess> | null

  if (
    typeof access?.everyone !== 'boolean' ||
    !Array.isArray(access.userIds) ||
    !access.userIds.every((id) => typeof id === 'string')
  )
    throw new TypeError('Expected a computer access list')

  return { everyone: access.everyone, userIds: access.userIds }
}

function historyRange(value: unknown): '1d' | '7d' | '30d' {
  if (value !== '1d' && value !== '7d' && value !== '30d') throw new TypeError('Expected a range')

  return value
}
function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : string(value)
}

function localShare(value: unknown): LocalShareInput {
  const input = value as Partial<LocalShareInput> | null
  const level = (['off', 'approve', 'full'] as const).find((known) => known === input?.level)

  if (!level || !input) throw new TypeError('Expected a sharing level')

  return { level, ...boxAccess(input) }
}

export const boxChannels = {
  'box:usage': (_e: unknown, teamId: unknown) => getBoxUsage(string(teamId)),
  'box:usageHistory': (_e: unknown, teamId: unknown, range: unknown) =>
    getBoxUsageHistory(string(teamId), historyRange(range)),
  'box:billingPage': (_e: unknown, teamId: unknown, vcpus: unknown) =>
    boxBillingPage(string(teamId), typeof vcpus === 'number' ? vcpus : undefined),
  'box:billingSummary': (_e: unknown, teamId: unknown) => boxBillingSummary(string(teamId)),
  'box:listDevices': (_e?: unknown, options?: AgentDeviceListOptions) => listAgentDevices(options),
  'box:create': (
    _e: unknown,
    label?: unknown,
    teamId?: unknown,
    vcpus?: unknown,
    access?: unknown,
  ) =>
    createBox(
      optionalString(label),
      optionalString(teamId),
      typeof vcpus === 'number' ? vcpus : undefined,
      access === undefined ? undefined : boxAccess(access),
    ),
  'box:createAgent': (
    _e: unknown,
    deviceId: unknown,
    teamId: unknown,
    provider: unknown,
    label?: unknown,
  ) =>
    createDeviceAgent(
      string(deviceId),
      string(teamId),
      agentProvider(provider),
      optionalString(label),
    ),
  'box:removeAgent': (_e: unknown, deviceId: unknown, teamId: unknown, instanceId: unknown) =>
    removeDeviceAgent(string(deviceId), string(teamId), string(instanceId)),
  'box:renameAgent': (
    _e: unknown,
    deviceId: unknown,
    teamId: unknown,
    agent: unknown,
    label: unknown,
  ) => renameDeviceAgent(string(deviceId), string(teamId), string(agent), string(label)),
  'box:pause': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    pauseBox(string(deviceId), string(teamId)),
  'box:resume': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    resumeBox(string(deviceId), string(teamId)),
  'box:delete': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    deleteBox(string(deviceId), string(teamId)),
  'box:removeDevice': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    removeDevice(string(deviceId), string(teamId)),
  'box:desktop': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    boxDesktop(string(deviceId), string(teamId)),
  'box:join-token': () => boxJoinToken(),
  'box:setAccess': (_e: unknown, deviceId: unknown, teamId: unknown, access: unknown) =>
    setBoxAccess(string(deviceId), string(teamId), boxAccess(access)),
  'box:openSessionDesktop': (_e: unknown, teamId: unknown, sessionId: unknown) =>
    openSessionDesktop(string(teamId), string(sessionId)),
  'box:rename': (_e: unknown, deviceId: unknown, teamId: unknown, label: unknown) =>
    renameBox(string(deviceId), string(teamId), string(label)),
  'localShare:get': (_e: unknown, deviceId: unknown, teamId: unknown) =>
    getDeviceShare(string(deviceId), string(teamId)),
  'localShare:set': (_e: unknown, deviceId: unknown, teamId: unknown, input: unknown) =>
    setDeviceShare(string(deviceId), string(teamId), localShare(input)),
  'localShare:approvals': (_e: unknown, teamId: unknown) => listShareApprovals(string(teamId)),
  'localShare:status': (_e: unknown, sessionId: unknown) =>
    ownShareApprovalStatus(string(sessionId)),
  'localShare:decide': (_e: unknown, approvalId: unknown, approve: unknown) => {
    if (typeof approve !== 'boolean') throw new TypeError('Expected a decision')

    return decideShareApproval(string(approvalId), approve)
  },
}
