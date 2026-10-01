import { ipcRenderer } from 'electron'

import type {
  CreateRuntimeInput,
  PairExternalRuntimeInput,
  RegisterExternalRuntimeInput,
  UpdateRuntimeInput,
} from '../../src/types/runtime'

export const runtimeApi = {
  atlasStartRuntimeLogin: (teamId: string, runtimeId: string) =>
    ipcRenderer.invoke('atlas:startRuntimeLogin', teamId, runtimeId),
  atlasGetRuntimeLogin: (teamId: string, runtimeId: string) =>
    ipcRenderer.invoke('atlas:getRuntimeLogin', teamId, runtimeId),
  atlasCancelRuntimeLogin: (teamId: string, runtimeId: string, attemptId: string) =>
    ipcRenderer.invoke('atlas:cancelRuntimeLogin', teamId, runtimeId, attemptId),
  atlasSubmitRuntimeLoginCode: (
    teamId: string,
    runtimeId: string,
    attemptId: string,
    code: string,
  ) => ipcRenderer.invoke('atlas:submitRuntimeLoginCode', teamId, runtimeId, attemptId, code),
  atlasListRuntimeInstances: (teamId: string) =>
    ipcRenderer.invoke('atlas:listRuntimeInstances', teamId),
  atlasListRuntimeQuotas: (teamId: string) => ipcRenderer.invoke('atlas:listRuntimeQuotas', teamId),
  atlasCreateRuntimeInstance: (teamId: string, input: CreateRuntimeInput) =>
    ipcRenderer.invoke('atlas:createRuntimeInstance', teamId, input),
  atlasProbeExternalRuntimeProvider: (teamId: string, url: string, password: string) =>
    ipcRenderer.invoke('atlas:probeExternalRuntimeProvider', teamId, url, password),
  atlasRegisterExternalRuntime: (teamId: string, input: RegisterExternalRuntimeInput) =>
    ipcRenderer.invoke('atlas:registerExternalRuntime', teamId, input),
  atlasPairExternalRuntime: (teamId: string, input: PairExternalRuntimeInput) =>
    ipcRenderer.invoke('atlas:pairExternalRuntime', teamId, input),
  atlasUpdateRuntimeInstance: (teamId: string, runtimeId: string, input: UpdateRuntimeInput) =>
    ipcRenderer.invoke('atlas:updateRuntimeInstance', teamId, runtimeId, input),
  atlasRemoveRuntimeInstance: (teamId: string, runtimeId: string) =>
    ipcRenderer.invoke('atlas:removeRuntimeInstance', teamId, runtimeId),
  atlasGetRuntimeModels: (teamId: string, runtimeId: string, model?: string) =>
    ipcRenderer.invoke('atlas:getRuntimeModels', teamId, runtimeId, model),
  atlasRequestRuntimeUpdate: (teamId: string, runtimeId: string) =>
    ipcRenderer.invoke('atlas:requestRuntimeUpdate', teamId, runtimeId),
  atlasGetRuntimeInstanceStatus: (teamId: string, runtimeId: string) =>
    ipcRenderer.invoke('atlas:getRuntimeInstanceStatus', teamId, runtimeId),
  atlasGetRuntimeInstanceMetrics: (teamId: string, runtimeId: string, hours: number) =>
    ipcRenderer.invoke('atlas:getRuntimeInstanceMetrics', teamId, runtimeId, hours),
}
