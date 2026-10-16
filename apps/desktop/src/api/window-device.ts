import type {
  AgentDevice,
  AgentDeviceList,
  AgentDeviceListOptions,
  BillingSummary,
  BoxStatus,
  BoxUsage,
  DeviceAgentInstance,
  SleepPreferences,
  SleepState,
  DeviceExecAuditPage,
  LocalAgentLoginState,
  LocalAgentProvider,
  DeviceIdentity,
  LocalRuntimeActivityPage,
  LocalRuntimeState,
} from './device-types.ts'

export type WindowDeviceApi = {
  onWindowFullScreenChanged?: (cb: (fullScreen: boolean) => void) => () => void
  deviceGetIdentity(): Promise<DeviceIdentity>
  deviceSetLabel(label: string): Promise<DeviceIdentity>
  deviceListAudit(before?: string): Promise<DeviceExecAuditPage>
  localRuntimeStartCodexLogin(): Promise<LocalAgentLoginState>
  localRuntimeCancelCodexLogin(): Promise<void>
  localRuntimeStartClaudeLogin(): Promise<LocalAgentLoginState>
  localRuntimeCancelClaudeLogin(): Promise<void>
  localRuntimeSetSleepPreferences(value: SleepPreferences): Promise<SleepState>
  localRuntimeGetState(): Promise<LocalRuntimeState>
  onLocalRuntimeState(cb: (state: LocalRuntimeState) => void): () => void
  localRuntimeRefresh(): Promise<LocalRuntimeState>
  localRuntimeUpdateAgent(provider: LocalAgentProvider): Promise<LocalRuntimeState>
  localRuntimeLatestAgentVersions(): Promise<Partial<Record<LocalAgentProvider, string>>>
  localRuntimeOpenWorkspace(): Promise<void>
  localRuntimeListActivity(before?: string): Promise<LocalRuntimeActivityPage>
  boxListDevices(options?: AgentDeviceListOptions): Promise<AgentDeviceList>
  boxCreate(label?: string, teamId?: string): Promise<AgentDevice>
  boxPause(deviceId: string, teamId: string): Promise<{ box: BoxStatus }>
  boxResume(deviceId: string, teamId: string): Promise<{ box: BoxStatus }>
  boxDelete(deviceId: string, teamId: string): Promise<{ ok: true }>
  deviceRemove(deviceId: string, teamId: string): Promise<{ ok: true }>
  boxCreateAgent(
    deviceId: string,
    teamId: string,
    provider: LocalAgentProvider,
  ): Promise<DeviceAgentInstance>
  boxRemoveAgent(deviceId: string, teamId: string, instanceId: string): Promise<void>
  boxRename(deviceId: string, teamId: string, label: string): Promise<{ ok: true }>
  boxDesktop(deviceId: string, teamId: string): Promise<{ url: string; label: string }>
  openSessionDesktop(teamId: string, sessionId: string): Promise<{ display: number }>
  boxUsage(teamId: string): Promise<BoxUsage>
  boxBillingPage(teamId: string, vcpus?: number): Promise<{ url: string }>
  boxBillingSummary(teamId: string): Promise<BillingSummary>
  boxJoinToken(): Promise<{ token: string; expiresAt: string; apiUrl: string | null }>
}
