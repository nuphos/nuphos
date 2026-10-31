import type {
  AgentDeviceListOptions,
  BoxAccess,
  LocalAgentProvider,
  LocalRuntimeState,
  LocalShareInput,
  SleepPreferences,
  ShareTrustDuration,
} from './device-types.ts'

export const deviceApi = {
  deviceGetIdentity: () => window.api.deviceGetIdentity(),
  deviceSetLabel: (label: string) => window.api.deviceSetLabel(label),
  /** Ends a phone watching this dock tab (`dock-tabs.ts`). */
  stopDockTabWatch: (tabId: string) => window.api.stopDockTabWatch(tabId),
  deviceListAudit: (before?: string) => window.api.deviceListAudit(before),
  localRuntimeSubmitClaudeLoginCode: (code: string) =>
    window.api.localRuntimeSubmitClaudeLoginCode(code),
  localRuntimeStartClaudeLogin: () => window.api.localRuntimeStartClaudeLogin(),
  localRuntimeStartCodexLogin: () => window.api.localRuntimeStartCodexLogin(),
  localRuntimeCancelClaudeLogin: () => window.api.localRuntimeCancelClaudeLogin(),
  localRuntimeCancelCodexLogin: () => window.api.localRuntimeCancelCodexLogin(),
  localRuntimeSetSleepPreferences: (value: SleepPreferences) =>
    window.api.localRuntimeSetSleepPreferences(value),
  localRuntimeSetPhoneControl: (allowed: boolean) =>
    window.api.localRuntimeSetPhoneControl(allowed),
  localRuntimeGetState: () => window.api.localRuntimeGetState(),
  onLocalRuntimeState: (cb: (state: LocalRuntimeState) => void) =>
    window.api.onLocalRuntimeState(cb),
  localRuntimeRefresh: () => window.api.localRuntimeRefresh(),
  localRuntimeUpdateAgent: (provider: LocalAgentProvider) =>
    window.api.localRuntimeUpdateAgent(provider),
  localRuntimeInstallAgent: (provider: LocalAgentProvider) =>
    window.api.localRuntimeInstallAgent(provider),
  localRuntimeLatestAgentVersions: () => window.api.localRuntimeLatestAgentVersions(),
  localRuntimeOpenWorkspace: () => window.api.localRuntimeOpenWorkspace(),
  localRuntimeListActivity: (before?: string) => window.api.localRuntimeListActivity(before),
  boxListDevices: (options?: AgentDeviceListOptions) => window.api.boxListDevices(options),
  boxCreate: (label?: string, teamId?: string, vcpus?: number, access?: BoxAccess) =>
    window.api.boxCreate(label, teamId, vcpus, access),
  boxPause: (deviceId: string, teamId: string) => window.api.boxPause(deviceId, teamId),
  boxResume: (deviceId: string, teamId: string) => window.api.boxResume(deviceId, teamId),
  boxDelete: (deviceId: string, teamId: string) => window.api.boxDelete(deviceId, teamId),
  deviceRemove: (deviceId: string, teamId: string) => window.api.deviceRemove(deviceId, teamId),
  boxDesktop: (deviceId: string, teamId: string) => window.api.boxDesktop(deviceId, teamId),
  boxJoinToken: () => window.api.boxJoinToken(),
  openSessionDesktop: (teamId: string, sessionId: string) =>
    window.api.openSessionDesktop(teamId, sessionId),
  boxCreateAgent: (
    deviceId: string,
    teamId: string,
    provider: LocalAgentProvider,
    label?: string,
  ) => window.api.boxCreateAgent(deviceId, teamId, provider, label),
  boxRemoveAgent: (deviceId: string, teamId: string, instanceId: string) =>
    window.api.boxRemoveAgent(deviceId, teamId, instanceId),
  boxRenameAgent: (deviceId: string, teamId: string, agent: string, label: string) =>
    window.api.boxRenameAgent(deviceId, teamId, agent, label),
  boxRename: (deviceId: string, teamId: string, label: string) =>
    window.api.boxRename(deviceId, teamId, label),
  boxSetAccess: (deviceId: string, teamId: string, access: BoxAccess) =>
    window.api.boxSetAccess(deviceId, teamId, access),
  localShareGet: (deviceId: string, teamId: string) => window.api.localShareGet(deviceId, teamId),
  localShareSet: (deviceId: string, teamId: string, input: LocalShareInput) =>
    window.api.localShareSet(deviceId, teamId, input),
  localShareApprovals: (teamId: string) => window.api.localShareApprovals(teamId),
  localShareStatus: (sessionId: string) => window.api.localShareStatus(sessionId),
  localShareDecide: (approvalId: string, approve: boolean, trust?: ShareTrustDuration) =>
    window.api.localShareDecide(approvalId, approve, trust),
  localShareTrusts: (deviceId: string, teamId: string) =>
    window.api.localShareTrusts(deviceId, teamId),
  localShareUntrust: (deviceId: string, teamId: string, actorId: string) =>
    window.api.localShareUntrust(deviceId, teamId, actorId),
  localShareNotify: (approvalId: string, teamId: string, title: string, body: string) =>
    window.api.localShareNotify(approvalId, teamId, title, body),
  boxUsage: (teamId: string) => window.api.boxUsage(teamId),
  boxUsageHistory: (teamId: string, range: '1d' | '7d' | '30d') =>
    window.api.boxUsageHistory(teamId, range),
  boxBillingPage: (teamId: string, vcpus?: number) => window.api.boxBillingPage(teamId, vcpus),
  boxBillingSummary: (teamId: string) => window.api.boxBillingSummary(teamId),
}
