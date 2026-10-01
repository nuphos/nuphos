import { call } from './client'

import type { OpenAbRuntimeStatus } from './claude-code'
import type {
  CreateRuntimeInput,
  ExternalRuntimeProviderProbe,
  RuntimeModelCatalog,
  RuntimeInstance,
  RuntimeLoginStatus,
  RuntimeMetrics,
  RuntimeQuota,
  PairExternalRuntimeInput,
  PairedExternalRuntime,
  RegisterExternalRuntimeInput,
  UpdateRuntimeInput,
} from '../../src/types/runtime'

function path(teamId: string, runtimeId?: string): string {
  const base = `/teams/${encodeURIComponent(teamId)}/agent-runtimes`

  return runtimeId ? `${base}/${encodeURIComponent(runtimeId)}` : base
}

export async function listRuntimeInstances(teamId: string): Promise<RuntimeInstance[]> {
  return (await call<{ runtimes: RuntimeInstance[] }>('GET', path(teamId))).runtimes
}
export function createRuntimeInstance(
  teamId: string,
  input: CreateRuntimeInput,
): Promise<RuntimeInstance> {
  return call('POST', path(teamId), input, { retry: false })
}
export function probeExternalRuntimeProvider(
  teamId: string,
  url: string,
  password: string,
): Promise<ExternalRuntimeProviderProbe> {
  return call(
    'POST',
    `${path(teamId)}/probe-provider`,
    { url, authKey: password },
    {
      retry: false,
    },
  )
}
export function registerExternalRuntime(
  teamId: string,
  input: RegisterExternalRuntimeInput,
): Promise<{ id: string }> {
  return call(
    'POST',
    `${path(teamId)}/external`,
    {
      url: input.url,
      authKey: input.password,
      ...(input.provider ? { provider: input.provider } : {}),
    },
    { retry: false },
  )
}
export function pairExternalRuntime(
  teamId: string,
  input: PairExternalRuntimeInput,
): Promise<PairedExternalRuntime> {
  return call('POST', `${path(teamId)}/pair`, input, { retry: false })
}
export function updateRuntimeInstance(
  teamId: string,
  runtimeId: string,
  input: UpdateRuntimeInput,
): Promise<RuntimeInstance> {
  return call('PATCH', path(teamId, runtimeId), input, { retry: false })
}
export function removeRuntimeInstance(teamId: string, runtimeId: string): Promise<void> {
  return call('DELETE', path(teamId, runtimeId), undefined, { retry: false })
}
export function getRuntimeInstanceStatus(
  teamId: string,
  runtimeId: string,
): Promise<OpenAbRuntimeStatus> {
  return call('GET', `${path(teamId, runtimeId)}/status`)
}
export function getRuntimeInstanceMetrics(
  teamId: string,
  runtimeId: string,
  hours: number,
): Promise<RuntimeMetrics> {
  return call('GET', `${path(teamId, runtimeId)}/metrics?hours=${String(hours)}`)
}
export async function listRuntimeQuotas(teamId: string): Promise<RuntimeQuota[]> {
  return (await call<{ quotas: RuntimeQuota[] }>('GET', `${path(teamId)}/quota`)).quotas
}

export function startRuntimeLogin(teamId: string, runtimeId: string): Promise<RuntimeLoginStatus> {
  return call('POST', `${path(teamId, runtimeId)}/login`, undefined, { retry: false })
}
export function getRuntimeLogin(teamId: string, runtimeId: string): Promise<RuntimeLoginStatus> {
  return call('GET', `${path(teamId, runtimeId)}/login`)
}
export function cancelRuntimeLogin(
  teamId: string,
  runtimeId: string,
  attemptId: string,
): Promise<void> {
  return call('DELETE', `${path(teamId, runtimeId)}/login`, { attemptId }, { retry: false })
}
export function submitRuntimeLoginCode(
  teamId: string,
  runtimeId: string,
  attemptId: string,
  code: string,
): Promise<RuntimeLoginStatus> {
  return call(
    'POST',
    `${path(teamId, runtimeId)}/login/code`,
    { attemptId, code },
    { retry: false },
  )
}

export function getRuntimeModels(
  teamId: string,
  runtimeId: string,
  model?: string,
): Promise<RuntimeModelCatalog> {
  const query = model ? `?model=${encodeURIComponent(model)}` : ''

  return call('GET', `${path(teamId, runtimeId)}/models${query}`, undefined, {
    retry: false,
    timeoutMs: 60_000,
  })
}

export function requestRuntimeUpdate(
  teamId: string,
  runtimeId: string,
): Promise<{ version: string }> {
  return call('POST', `${path(teamId, runtimeId)}/update`, undefined, { retry: false })
}
