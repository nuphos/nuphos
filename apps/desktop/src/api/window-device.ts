import type {
  AgentDevice,
  AgentDeviceList,
  AgentDeviceListOptions,
  BoxStatus,
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
  boxPause(deviceId: string): Promise<{ box: BoxStatus }>
  boxResume(deviceId: string): Promise<{ box: BoxStatus }>
  boxDelete(deviceId: string): Promise<{ ok: true }>
  boxCreateAgent(
    deviceId: string,
    teamId: string,
    provider: LocalAgentProvider,
  ): Promise<DeviceAgentInstance>
  boxRename(deviceId: string, label: string): Promise<{ ok: true }>
  boxDesktop(deviceId: string): Promise<{ url: string }>
  boxJoinToken(): Promise<{ token: string; expiresAt: string; apiUrl: string | null }>
}
