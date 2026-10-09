import {
  getDeviceIdentity,
  listDeviceAudit,
  setLocalAgentDefaults,
  updateDeviceLabel,
} from './device-controller.ts'
import {
  getLocalRuntimeState,
  startLocalClaudeLogin,
  startLocalCodexLogin,
  cancelLocalCodexLogin,
  cancelLocalClaudeLogin,
  listLocalRuntimeActivity,
  openLocalRuntimeWorkspace,
  refreshLocalRuntime,
} from './local-runtime/index.ts'

export const deviceChannels = {
  'device:getIdentity': () => getDeviceIdentity(),
  'device:setLabel': (_e: unknown, label: string) => updateDeviceLabel(label),
  'device:listAudit': (_e: unknown, before?: string) => listDeviceAudit(before),
  'localRuntime:startCodexLogin': () => startLocalCodexLogin(),
  'localRuntime:cancelCodexLogin': () => cancelLocalCodexLogin(),
  'localRuntime:startClaudeLogin': () => startLocalClaudeLogin(),
  'localRuntime:cancelClaudeLogin': () => cancelLocalClaudeLogin(),
  'localRuntime:getState': () => getLocalRuntimeState(),
  'localAgent:setDefaults': (_e: unknown, runtimeId: string, defaults: unknown) =>
    setLocalAgentDefaults(runtimeId, defaults),
  'localRuntime:refresh': () => refreshLocalRuntime(),
  'localRuntime:openWorkspace': () => openLocalRuntimeWorkspace(),
  'localRuntime:listActivity': (_e: unknown, before?: string) => listLocalRuntimeActivity(before),
}
