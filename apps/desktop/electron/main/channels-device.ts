import { getDeviceIdentity, listDeviceAudit, updateDeviceLabel } from './device-controller.ts'
import {
  getLocalRuntimeState,
  startLocalClaudeLogin,
  startLocalCodexLogin,
  cancelLocalCodexLogin,
  cancelLocalClaudeLogin,
  listLocalRuntimeActivity,
  openLocalRuntimeWorkspace,
  refreshLocalRuntime,
  userEnv,
} from './local-runtime/index.ts'
import { latestAgentCliVersions, updateAgentCli } from './local-runtime/agent-cli-update.ts'

import type { LocalAgentProvider } from './local-runtime/agent-cli.ts'

export const deviceChannels = {
  'device:getIdentity': () => getDeviceIdentity(),
  'device:setLabel': (_e: unknown, label: string) => updateDeviceLabel(label),
  'device:listAudit': (_e: unknown, before?: string) => listDeviceAudit(before),
  'localRuntime:startCodexLogin': () => startLocalCodexLogin(),
  'localRuntime:cancelCodexLogin': () => cancelLocalCodexLogin(),
  'localRuntime:startClaudeLogin': () => startLocalClaudeLogin(),
  'localRuntime:cancelClaudeLogin': () => cancelLocalClaudeLogin(),
  'localRuntime:getState': () => getLocalRuntimeState(),
  'localRuntime:refresh': () => refreshLocalRuntime(),
  // Running agents keep their version; the next one started picks up the update.
  'localRuntime:updateAgent': async (_e: unknown, provider: LocalAgentProvider) => {
    await updateAgentCli(provider, await userEnv())

    return refreshLocalRuntime()
  },
  'localRuntime:latestAgentVersions': () => latestAgentCliVersions(),
  'localRuntime:openWorkspace': () => openLocalRuntimeWorkspace(),
  'localRuntime:listActivity': (_e: unknown, before?: string) => listLocalRuntimeActivity(before),
}
