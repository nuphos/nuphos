import { appendQuery, call, callMultipart } from './client'

import type { DashboardViewRange } from '../../src/dashboards/schema'

export async function archListDiagrams(teamId: string): Promise<unknown> {
  const data = await call<{ diagrams: unknown[] }>('GET', `/teams/${teamId}/architecture-diagrams`)

  return data.diagrams ?? []
}

export async function archGetDiagram(teamId: string, diagramId: string): Promise<unknown> {
  return call('GET', `/teams/${teamId}/architecture-diagrams/${diagramId}`)
}

export async function archCreateDiagram(teamId: string, name: string): Promise<unknown> {
  return call('POST', `/teams/${teamId}/architecture-diagrams`, { name }, { retry: false })
}

export async function archSaveDiagram(
  teamId: string,
  diagramId: string,
  patch: unknown,
): Promise<unknown> {
  return call('PUT', `/teams/${teamId}/architecture-diagrams/${diagramId}`, patch)
}

export async function archDeleteDiagram(teamId: string, diagramId: string): Promise<void> {
  await call('DELETE', `/teams/${teamId}/architecture-diagrams/${diagramId}`)
}

// --- Dashboards (script-driven live panels) ---

export async function dashboardsList(teamId: string): Promise<unknown> {
  const data = await call<{ dashboards: unknown[] }>('GET', `/teams/${teamId}/dashboards`)

  return data.dashboards ?? []
}
export async function dashboardsCreate(teamId: string, input: unknown): Promise<unknown> {
  return call('POST', `/teams/${teamId}/dashboards`, input, { retry: false })
}
export async function dashboardsGet(
  teamId: string,
  dashboardId: string,
  viewRange?: DashboardViewRange,
): Promise<unknown> {
  return call('GET', appendQuery(`/teams/${teamId}/dashboards/${dashboardId}`, viewRange ?? {}))
}
export async function dashboardsUpdate(
  teamId: string,
  dashboardId: string,
  input: unknown,
): Promise<unknown> {
  return call('PUT', `/teams/${teamId}/dashboards/${dashboardId}`, input, { retry: false })
}
export async function dashboardsDelete(teamId: string, dashboardId: string): Promise<void> {
  await call('DELETE', `/teams/${teamId}/dashboards/${dashboardId}`, undefined, {
    retry: false,
  })
}
export async function dashboardsRefresh(
  teamId: string,
  dashboardId: string,
  force?: boolean,
  viewRange?: DashboardViewRange,
): Promise<unknown> {
  const qs = new URLSearchParams({ ...viewRange, ...(force ? { force: '1' } : {}) }).toString()

  return call('POST', `/teams/${teamId}/dashboards/${dashboardId}/refresh?${qs}`, undefined, {
    retry: false,
  })
}
export async function dashboardsCreatePanel(
  teamId: string,
  dashboardId: string,
  input: unknown,
): Promise<unknown> {
  return call('POST', `/teams/${teamId}/dashboards/${dashboardId}/panels`, input, {
    retry: false,
  })
}
export async function dashboardsUpdatePanel(
  teamId: string,
  dashboardId: string,
  panelId: string,
  input: unknown,
): Promise<unknown> {
  return call('PUT', `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}`, input, {
    retry: false,
  })
}
export async function dashboardsDeletePanel(
  teamId: string,
  dashboardId: string,
  panelId: string,
): Promise<void> {
  await call('DELETE', `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}`, undefined, {
    retry: false,
  })
}
export async function dashboardsExecutePanel(
  teamId: string,
  dashboardId: string,
  panelId: string,
  force?: boolean,
  viewRange?: DashboardViewRange,
): Promise<unknown> {
  const qs = new URLSearchParams({ ...viewRange, ...(force ? { force: '1' } : {}) }).toString()

  return call(
    'POST',
    `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}/execute?${qs}`,
    undefined,
    { retry: false },
  )
}
export async function dashboardsGenerateInsight(
  teamId: string,
  dashboardId: string,
  panelId: string,
  viewRange?: DashboardViewRange,
): Promise<unknown> {
  return call(
    'POST',
    appendQuery(
      `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}/insight`,
      viewRange ?? {},
    ),
    undefined,
    { retry: false },
  )
}
export async function dashboardsInsightFeedback(
  teamId: string,
  dashboardId: string,
  panelId: string,
  rating: 'up' | 'down',
  note?: string,
  viewRange?: DashboardViewRange,
): Promise<unknown> {
  return call(
    'POST',
    appendQuery(
      `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}/insight/feedback`,
      viewRange ?? {},
    ),
    { rating, note },
    { retry: false },
  )
}
export async function dashboardsGetAlert(
  teamId: string,
  dashboardId: string,
  panelId: string,
): Promise<unknown> {
  return call('GET', `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}/alert`)
}
export async function dashboardsSaveAlert(
  teamId: string,
  dashboardId: string,
  panelId: string,
  input: unknown,
): Promise<unknown> {
  return call('PUT', `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}/alert`, input, {
    retry: false,
  })
}
export async function dashboardsDeleteAlert(
  teamId: string,
  dashboardId: string,
  panelId: string,
): Promise<unknown> {
  return call(
    'DELETE',
    `/teams/${teamId}/dashboards/${dashboardId}/panels/${panelId}/alert`,
    undefined,
    { retry: false },
  )
}

// --- Team skills (S3-backed agent skills store) ---

export async function teamSkillsGetManifest(teamId: string): Promise<unknown> {
  return call('GET', `/teams/${teamId}/skills/manifest`)
}

export async function teamSkillsListObjects(teamId: string): Promise<unknown> {
  return call('GET', `/teams/${teamId}/skills/objects`)
}

export async function teamSkillsGetObject(teamId: string, key: string): Promise<unknown> {
  return call('GET', appendQuery(`/teams/${teamId}/skills/object`, { key }))
}

export async function teamSkillsGetHistory(teamId: string, name: string): Promise<unknown> {
  return call('GET', appendQuery(`/teams/${teamId}/skills/history`, { name }))
}

export async function teamSkillsPutObject(
  teamId: string,
  key: string,
  file: { filename: string; bytes: Uint8Array; contentType?: string },
): Promise<unknown> {
  return callMultipart(`/teams/${teamId}/skills/object`, { key }, file, { timeoutMs: 120_000 })
}

export async function teamSkillsDeleteObject(teamId: string, key: string): Promise<void> {
  await call('DELETE', appendQuery(`/teams/${teamId}/skills/object`, { key }))
}

export async function teamSkillsDeleteSkill(
  teamId: string,
  name: string,
): Promise<{ name: string; deletedCount: number; keys: string[] }> {
  return call('DELETE', appendQuery(`/teams/${teamId}/skills/skill`, { name }))
}
