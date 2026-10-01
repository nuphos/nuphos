import type { RuntimeDefaults } from '../types/runtime.ts'
import type {
  DeviceExecAuditPage,
  DeviceIdentity,
  LocalRuntimeActivityPage,
  LocalRuntimeState,
} from './device-types.ts'

export type WindowDeviceApi = {
  onWindowFullScreenChanged?: (cb: (fullScreen: boolean) => void) => () => void
  deviceGetIdentity(): Promise<DeviceIdentity>
  deviceSetLabel(label: string): Promise<DeviceIdentity>
  deviceListAudit(before?: string): Promise<DeviceExecAuditPage>
  localRuntimeGetState(): Promise<LocalRuntimeState>
  localAgentSetDefaults(runtimeId: string, defaults: RuntimeDefaults): Promise<void>
  onLocalRuntimeState(cb: (state: LocalRuntimeState) => void): () => void
  localRuntimeRefresh(): Promise<LocalRuntimeState>
  localRuntimeOpenWorkspace(): Promise<void>
  localRuntimeListActivity(before?: string): Promise<LocalRuntimeActivityPage>
}
