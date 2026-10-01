import {
  getLocalRuntimeState,
  listLocalRuntimeActivity,
  openLocalRuntimeWorkspace,
  refreshLocalRuntime,
} from './local-runtime/index.ts'
import {
  getDeviceIdentity,
  listDeviceAudit,
  setLocalAgentDefaults,
  updateDeviceLabel,
} from './device-controller.ts'

export const deviceChannels = {
  'device:getIdentity': () => getDeviceIdentity(),
  'device:setLabel': (_e: unknown, label: string) => updateDeviceLabel(label),
  'device:listAudit': (_e: unknown, before?: string) => listDeviceAudit(before),
  'localRuntime:getState': () => getLocalRuntimeState(),
  'localAgent:setDefaults': (_e: unknown, runtimeId: string, defaults: unknown) =>
    setLocalAgentDefaults(runtimeId, defaults),
  'localRuntime:refresh': () => refreshLocalRuntime(),
  'localRuntime:openWorkspace': () => openLocalRuntimeWorkspace(),
  'localRuntime:listActivity': (_e: unknown, before?: string) => listLocalRuntimeActivity(before),
}
