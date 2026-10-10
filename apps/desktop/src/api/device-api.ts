import type { LocalAgentProvider, LocalRuntimeState } from './device-types.ts'
import type { RuntimeDefaults } from '../types/runtime.ts'

export const deviceApi = {
  deviceGetIdentity: () => window.api.deviceGetIdentity(),
  deviceSetLabel: (label: string) => window.api.deviceSetLabel(label),
  deviceListAudit: (before?: string) => window.api.deviceListAudit(before),
  localRuntimeStartClaudeLogin: () => window.api.localRuntimeStartClaudeLogin(),
  localRuntimeStartCodexLogin: () => window.api.localRuntimeStartCodexLogin(),
  localRuntimeCancelClaudeLogin: () => window.api.localRuntimeCancelClaudeLogin(),
  localRuntimeCancelCodexLogin: () => window.api.localRuntimeCancelCodexLogin(),
  localRuntimeGetState: () => window.api.localRuntimeGetState(),
  localAgentSetDefaults: (runtimeId: string, defaults: RuntimeDefaults) =>
    window.api.localAgentSetDefaults(runtimeId, defaults),
  onLocalRuntimeState: (cb: (state: LocalRuntimeState) => void) =>
    window.api.onLocalRuntimeState(cb),
  localRuntimeRefresh: () => window.api.localRuntimeRefresh(),
  localRuntimeUpdateAgent: (provider: LocalAgentProvider) =>
    window.api.localRuntimeUpdateAgent(provider),
  localRuntimeLatestAgentVersions: () => window.api.localRuntimeLatestAgentVersions(),
  localRuntimeOpenWorkspace: () => window.api.localRuntimeOpenWorkspace(),
  localRuntimeListActivity: (before?: string) => window.api.localRuntimeListActivity(before),
}
