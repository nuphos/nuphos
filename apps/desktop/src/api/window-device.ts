import type {
  AgentDevice,
  AgentDeviceList,
  AgentDeviceListOptions,
  BillingSummary,
  BoxAccess,
  BoxStatus,
  BoxUsage,
  BoxUsageHistory,
  DeviceAgentInstance,
  SleepPreferences,
  SleepState,
  DeviceExecAuditPage,
  LocalAgentLoginState,
  LocalAgentProvider,
  DeviceIdentity,
  LocalRuntimeActivityPage,
  LocalRuntimeState,
  LocalAgentShareState,
  LocalShareApproval,
  LocalShareTrust,
  ShareApprovalStatus,
  LocalShareInput,
  ShareTrustDuration,
  SignInAsk,
} from './device-types.ts'

export type WindowDeviceApi = {
  onWindowFullScreenChanged?: (cb: (fullScreen: boolean) => void) => () => void
  deviceGetIdentity(): Promise<DeviceIdentity>
  deviceSetLabel(label: string): Promise<DeviceIdentity>
  deviceListAudit(before?: string): Promise<DeviceExecAuditPage>
  localRuntimeStartCodexLogin(): Promise<LocalAgentLoginState>
  localRuntimeCancelCodexLogin(): Promise<void>
  localRuntimeSubmitClaudeLoginCode(code: string): Promise<void>
  localRuntimeStartClaudeLogin(): Promise<LocalAgentLoginState>
  localRuntimeCancelClaudeLogin(): Promise<void>
  localRuntimeSetSleepPreferences(value: SleepPreferences): Promise<SleepState>
  localRuntimeGetState(): Promise<LocalRuntimeState>
  onLocalRuntimeState(cb: (state: LocalRuntimeState) => void): () => void
  localRuntimeRefresh(): Promise<LocalRuntimeState>
  localRuntimeUpdateAgent(provider: LocalAgentProvider): Promise<LocalRuntimeState>
  localRuntimeInstallAgent(provider: LocalAgentProvider): Promise<LocalRuntimeState>
  localRuntimeLatestAgentVersions(): Promise<Partial<Record<LocalAgentProvider, string>>>
  localRuntimeOpenWorkspace(): Promise<void>
  localRuntimeListActivity(before?: string): Promise<LocalRuntimeActivityPage>
  boxListDevices(options?: AgentDeviceListOptions): Promise<AgentDeviceList>
  boxCreate(
    label?: string,
    teamId?: string,
    vcpus?: number,
    access?: BoxAccess,
  ): Promise<AgentDevice>
  boxPause(deviceId: string, teamId: string): Promise<{ box: BoxStatus }>
  boxResume(deviceId: string, teamId: string): Promise<{ box: BoxStatus }>
  boxDelete(deviceId: string, teamId: string): Promise<{ ok: true }>
  deviceRemove(deviceId: string, teamId: string): Promise<{ ok: true }>
  boxCreateAgent(
    deviceId: string,
    teamId: string,
    provider: LocalAgentProvider,
    label?: string,
  ): Promise<DeviceAgentInstance>
  boxRemoveAgent(deviceId: string, teamId: string, instanceId: string): Promise<void>
  boxRenameAgent(
    deviceId: string,
    teamId: string,
    agent: string,
    label: string,
  ): Promise<{ ok: true }>
  boxRename(deviceId: string, teamId: string, label: string): Promise<{ ok: true }>
  boxSetAccess(deviceId: string, teamId: string, access: BoxAccess): Promise<unknown>
  localShareGet(deviceId: string, teamId: string): Promise<LocalAgentShareState>
  localShareSet(
    deviceId: string,
    teamId: string,
    input: LocalShareInput,
  ): Promise<LocalAgentShareState>
  localShareApprovals(teamId: string): Promise<LocalShareApproval[]>
  localShareStatus(sessionId: string): Promise<ShareApprovalStatus>
  localShareDecide(
    approvalId: string,
    approve: boolean,
    trust?: ShareTrustDuration,
  ): Promise<{ id: string; status: string }>
  localShareTrusts(deviceId: string, teamId: string): Promise<LocalShareTrust[]>
  localShareUntrust(deviceId: string, teamId: string, actorId: string): Promise<void>
  /** Tells the owner about a new request in a system notification, once per request. */
  localShareNotify(approvalId: string, teamId: string, title: string, body: string): Promise<void>
  localShareRemind(teamId: string, runtimeId: string, sessionId: string): Promise<SignInAsk>
  runtimeSignInAsk(teamId: string, runtimeId: string, sessionId: string): Promise<SignInAsk>
  runtimeSignInSettle(teamId: string, runtimeId: string): Promise<void>
  boxDesktop(deviceId: string, teamId: string): Promise<{ url: string; label: string }>
  openSessionDesktop(teamId: string, sessionId: string): Promise<{ display: number }>
  boxUsage(teamId: string): Promise<BoxUsage>
  boxUsageHistory(teamId: string, range: '1d' | '7d' | '30d'): Promise<BoxUsageHistory>
  boxBillingPage(teamId: string, vcpus?: number): Promise<{ url: string }>
  boxBillingSummary(teamId: string): Promise<BillingSummary>
  boxJoinToken(): Promise<{ token: string; expiresAt: string; apiUrl: string | null }>
}
