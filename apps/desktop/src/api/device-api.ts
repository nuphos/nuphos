import type {
  AgentDeviceListOptions,
  LocalAgentProvider,
  LocalRuntimeState,
  SleepPreferences,
} from './device-types.ts'

export const deviceApi = {
  deviceGetIdentity: () => window.api.deviceGetIdentity(),
  deviceSetLabel: (label: string) => window.api.deviceSetLabel(label),
  deviceListAudit: (before?: string) => window.api.deviceListAudit(before),
  localRuntimeStartClaudeLogin: () => window.api.localRuntimeStartClaudeLogin(),
  localRuntimeStartCodexLogin: () => window.api.localRuntimeStartCodexLogin(),
  localRuntimeCancelClaudeLogin: () => window.api.localRuntimeCancelClaudeLogin(),
  localRuntimeCancelCodexLogin: () => window.api.localRuntimeCancelCodexLogin(),
  localRuntimeSetSleepPreferences: (value: SleepPreferences) =>
    window.api.localRuntimeSetSleepPreferences(value),
  localRuntimeGetState: () => window.api.localRuntimeGetState(),
  onLocalRuntimeState: (cb: (state: LocalRuntimeState) => void) =>
    window.api.onLocalRuntimeState(cb),
  localRuntimeRefresh: () => window.api.localRuntimeRefresh(),
  localRuntimeUpdateAgent: (provider: LocalAgentProvider) =>
    window.api.localRuntimeUpdateAgent(provider),
  localRuntimeLatestAgentVersions: () => window.api.localRuntimeLatestAgentVersions(),
  localRuntimeOpenWorkspace: () => window.api.localRuntimeOpenWorkspace(),
  localRuntimeListActivity: (before?: string) => window.api.localRuntimeListActivity(before),
  boxListDevices: (options?: AgentDeviceListOptions) => window.api.boxListDevices(options),
  boxCreate: (label?: string, teamId?: string) => window.api.boxCreate(label, teamId),
  boxPause: (deviceId: string, teamId: string) => window.api.boxPause(deviceId, teamId),
  boxResume: (deviceId: string, teamId: string) => window.api.boxResume(deviceId, teamId),
  boxDelete: (deviceId: string, teamId: string) => window.api.boxDelete(deviceId, teamId),
  boxDesktop: (deviceId: string, teamId: string) => window.api.boxDesktop(deviceId, teamId),
  boxJoinToken: () => window.api.boxJoinToken(),
  boxCreateAgent: (deviceId: string, teamId: string, provider: LocalAgentProvider) =>
    window.api.boxCreateAgent(deviceId, teamId, provider),
  boxRename: (deviceId: string, teamId: string, label: string) =>
    window.api.boxRename(deviceId, teamId, label),
}
