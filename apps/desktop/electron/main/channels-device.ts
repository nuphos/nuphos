import * as atlas from '../atlas'

import { getDeviceIdentity, listDeviceAudit, updateDeviceLabel } from './device-controller.ts'
import { readThisComputerFile } from './linked-file.ts'
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
import { setSleepPreferences } from './local-runtime/sleep-prevention-electron.ts'

import type { LocalAgentProvider } from './local-runtime/agent-cli.ts'

export const deviceChannels = {
  'device:getIdentity': () => getDeviceIdentity(),
  'device:setLabel': (_e: unknown, label: string) => updateDeviceLabel(label),
  'device:listAudit': (_e: unknown, before?: string) => listDeviceAudit(before),
  'localRuntime:startCodexLogin': () => startLocalCodexLogin(),
  'localRuntime:cancelCodexLogin': () => cancelLocalCodexLogin(),
  'localRuntime:startClaudeLogin': () => startLocalClaudeLogin(),
  'localRuntime:cancelClaudeLogin': () => cancelLocalClaudeLogin(),
  'localRuntime:setSleepPreferences': (_e: unknown, value: unknown) => setSleepPreferences(value),
  'localRuntime:getState': () => getLocalRuntimeState(),
  'atlas:readLinkedFile': async (_e: unknown, ...args: [string, string, string, string]) => {
    const local = await readThisComputerFile(args[3], getLocalRuntimeState().workspace)

    return local
      ? { ...local, origin: 'this-computer' as const }
      : { ...(await atlas.readRuntimeFile(...args)), origin: 'agent' as const }
  },
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
