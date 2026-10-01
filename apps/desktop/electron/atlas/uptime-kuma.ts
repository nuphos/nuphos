import { appendQuery, call } from './client'

export type UptimeKumaInstance = {
  id: string
  label: string
  baseUrl: string
  username: string | null
  authType: 'password' | 'token'
  createdAt: string
}

export type UptimeKumaMonitor = {
  id: number
  name?: string | null
  type?: string | null
  url?: string | null
  active?: boolean | null
  interval?: number | null
  retryInterval?: number | null
  resendInterval?: number | null
  maxretries?: number | null
  accepted_statuscodes?: string[] | null
  status?: string | number | null
  parent?: string | number | null
  childrenIDs?: (string | number)[] | null
  weight?: string | number | null
  pathName?: string | null
  tags?: unknown[] | null
}

export async function listUptimeKumaInstances(teamId: string): Promise<UptimeKumaInstance[]> {
  const data = await call<{ instances: UptimeKumaInstance[] }>(
    'GET',
    `/teams/${teamId}/uptime-kuma-instances`,
  )

  return data.instances ?? []
}

export async function bindUptimeKumaInstance(
  teamId: string,
  input: {
    label: string
    baseUrl: string
    username?: string | null
    password?: string | null
    authToken?: string | null
  },
): Promise<UptimeKumaInstance> {
  return call<UptimeKumaInstance>(
    'POST',
    `/teams/${teamId}/uptime-kuma-instances`,
    {
      label: input.label,
      baseUrl: input.baseUrl,
      ...(input.username ? { username: input.username } : {}),
      ...(input.password ? { password: input.password } : {}),
      ...(input.authToken ? { authToken: input.authToken } : {}),
    },
    { retry: false },
  )
}

export async function updateUptimeKumaInstance(
  teamId: string,
  instanceId: string,
  patch: {
    label?: string
    baseUrl?: string
    username?: string | null
    password?: string | null
    authToken?: string | null
  },
): Promise<UptimeKumaInstance> {
  return call<UptimeKumaInstance>(
    'PATCH',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}`,
    patch,
    { retry: false },
  )
}

export async function unbindUptimeKumaInstance(teamId: string, instanceId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/uptime-kuma-instances/${instanceId}`, undefined, {
    retry: false,
  })
}

export async function listUptimeKumaMonitors(
  teamId: string,
  instanceId: string,
): Promise<UptimeKumaMonitor[]> {
  const data = await call<{ monitors: UptimeKumaMonitor[] }>(
    'GET',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors`,
  )

  return data.monitors ?? []
}

export async function getUptimeKumaMonitor(
  teamId: string,
  instanceId: string,
  monitorId: number,
): Promise<UptimeKumaMonitor> {
  const data = await call<{ monitor: UptimeKumaMonitor }>(
    'GET',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors/${encodeURIComponent(String(monitorId))}`,
  )

  return data.monitor
}

export async function createUptimeKumaMonitor(
  teamId: string,
  instanceId: string,
  input: Record<string, unknown>,
): Promise<{ monitorID?: number; monitor?: UptimeKumaMonitor }> {
  return call<{ monitorID?: number; monitor?: UptimeKumaMonitor }>(
    'POST',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors`,
    input,
    { retry: false },
  )
}

export async function updateUptimeKumaMonitor(
  teamId: string,
  instanceId: string,
  monitorId: number,
  patch: Record<string, unknown>,
): Promise<UptimeKumaMonitor> {
  const data = await call<{ monitor: UptimeKumaMonitor }>(
    'PATCH',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors/${encodeURIComponent(String(monitorId))}`,
    patch,
    { retry: false },
  )

  return data.monitor
}

export async function pauseUptimeKumaMonitor(
  teamId: string,
  instanceId: string,
  monitorId: number,
): Promise<void> {
  await call<void>(
    'POST',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors/${encodeURIComponent(String(monitorId))}/pause`,
    undefined,
    { retry: false },
  )
}

export async function resumeUptimeKumaMonitor(
  teamId: string,
  instanceId: string,
  monitorId: number,
): Promise<void> {
  await call<void>(
    'POST',
    `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors/${encodeURIComponent(String(monitorId))}/resume`,
    undefined,
    { retry: false },
  )
}

export async function deleteUptimeKumaMonitorById(
  teamId: string,
  instanceId: string,
  monitorId: number,
  deleteChildren = false,
): Promise<void> {
  await call<void>(
    'DELETE',
    appendQuery(
      `/teams/${teamId}/uptime-kuma-instances/${instanceId}/monitors/${encodeURIComponent(String(monitorId))}`,
      { deleteChildren },
    ),
    undefined,
    { retry: false },
  )
}
