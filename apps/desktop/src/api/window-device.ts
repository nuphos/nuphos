import type {
  DeviceExecAuditPage,
  LocalAgentLoginState,
  DeviceIdentity,
  LocalRuntimeActivityPage,
  LocalRuntimeState,
} from './device-types.ts'
import type { RuntimeDefaults } from '../types/runtime.ts'

export type WindowDeviceApi = {
  onWindowFullScreenChanged?: (cb: (fullScreen: boolean) => void) => () => void
  deviceGetIdentity(): Promise<DeviceIdentity>
  deviceSetLabel(label: string): Promise<DeviceIdentity>
  deviceListAudit(before?: string): Promise<DeviceExecAuditPage>
  localRuntimeStartCodexLogin(): Promise<LocalAgentLoginState>
  localRuntimeCancelCodexLogin(): Promise<void>
  localRuntimeStartClaudeLogin(): Promise<LocalAgentLoginState>
  localRuntimeCancelClaudeLogin(): Promise<void>
  localRuntimeGetState(): Promise<LocalRuntimeState>
  localAgentSetDefaults(runtimeId: string, defaults: RuntimeDefaults): Promise<void>
  onLocalRuntimeState(cb: (state: LocalRuntimeState) => void): () => void
  localRuntimeRefresh(): Promise<LocalRuntimeState>
  localRuntimeOpenWorkspace(): Promise<void>
  localRuntimeListActivity(before?: string): Promise<LocalRuntimeActivityPage>
}
