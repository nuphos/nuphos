import { call } from './client'

export type VantaIntegration = {
  id: string
  label: string
  orgDisplayName: string | null
  authType: 'client_credentials' | 'oauth'
  createdAt?: string
}

export type SecureframeIntegration = {
  id: string
  label: string
  region: 'us' | 'uk'
  createdAt?: string
}

export type SonarqubeIntegration = {
  id: string
  label: string
  baseUrl: string
  version: string | null
  createdAt?: string
}

export type SonarqubeProject = {
  key: string
  name: string
  qualifier?: string
  visibility?: string
  lastAnalysisDate?: string
  revision?: string
}

export type SonarqubeProjectsPage = {
  paging?: { pageIndex: number; pageSize: number; total: number }
  components?: SonarqubeProject[]
}

export type NotionIntegration = {
  id: string
  label: string
  workspaceName?: string | null
  createdAt?: string
}

export type SecureframeTest = {
  id: string
  description: string | null
  healthStatus: string | null
  enabled: boolean | null
  failureMessage: string | null
  remediation: string | null
  raw: Record<string, unknown>
}

export type VantaTest = {
  id: string
  name: string
  category: string
  status: string
  failureDescription: string | null
  remediationDescription: string | null
  lastTestRunDate: string | null
}

export async function listVantaIntegrations(teamId: string): Promise<VantaIntegration[]> {
  const data = await call<{ integrations: VantaIntegration[] }>(
    'GET',
    `/teams/${teamId}/vanta-integrations`,
  )

  return data.integrations ?? []
}

export async function bindVantaIntegration(
  teamId: string,
  label: string,
  clientId: string,
  clientSecret: string,
): Promise<VantaIntegration> {
  return call<VantaIntegration>(
    'POST',
    `/teams/${teamId}/vanta-integrations`,
    { label, clientId, clientSecret },
    { retry: false },
  )
}

export async function unbindVantaIntegration(teamId: string, integrationId: string): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/vanta-integrations/${integrationId}`, undefined, {
    retry: false,
  })
}

export async function listSecureframeIntegrations(
  teamId: string,
): Promise<SecureframeIntegration[]> {
  const data = await call<{ integrations: SecureframeIntegration[] }>(
    'GET',
    `/teams/${teamId}/secureframe-integrations`,
  )

  return data.integrations ?? []
}

export async function bindSecureframeIntegration(
  teamId: string,
  label: string,
  region: 'us' | 'uk',
  apiKey: string,
  apiSecret: string,
): Promise<SecureframeIntegration> {
  return call<SecureframeIntegration>(
    'POST',
    `/teams/${teamId}/secureframe-integrations`,
    { label, region, apiKey, apiSecret },
    { retry: false },
  )
}

export async function unbindSecureframeIntegration(
  teamId: string,
  integrationId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/secureframe-integrations/${integrationId}`,
    undefined,
    { retry: false },
  )
}

export async function listSonarqubeIntegrations(teamId: string): Promise<SonarqubeIntegration[]> {
  const data = await call<{ integrations: SonarqubeIntegration[] }>(
    'GET',
    `/teams/${teamId}/sonarqube-integrations`,
  )

  return data.integrations ?? []
}

export async function listSonarqubeProjects(
  teamId: string,
  integrationId: string,
  page = 1,
  pageSize = 5,
): Promise<SonarqubeProjectsPage> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })

  return call<SonarqubeProjectsPage>(
    'GET',
    `/teams/${teamId}/sonarqube-integrations/${integrationId}/projects?${query.toString()}`,
  )
}

export async function bindSonarqubeIntegration(
  teamId: string,
  label: string,
  baseUrl: string,
  token: string,
): Promise<SonarqubeIntegration> {
  return call<SonarqubeIntegration>(
    'POST',
    `/teams/${teamId}/sonarqube-integrations`,
    { label, baseUrl, token },
    { retry: false },
  )
}

export async function unbindSonarqubeIntegration(
  teamId: string,
  integrationId: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `/teams/${teamId}/sonarqube-integrations/${integrationId}`,
    undefined,
    { retry: false },
  )
}

export async function listNotionIntegrations(teamId: string): Promise<NotionIntegration[]> {
  const data = await call<{ integrations: NotionIntegration[] }>(
    'GET',
    `/teams/${teamId}/notion-integrations`,
  )

  return data.integrations ?? []
}

export async function bindNotionIntegration(
  teamId: string,
  label: string,
  token: string,
): Promise<NotionIntegration> {
  return call<NotionIntegration>(
    'POST',
    `/teams/${teamId}/notion-integrations`,
    { label, token },
    { retry: false },
  )
}

export async function unbindNotionIntegration(
  teamId: string,
  integrationId: string,
): Promise<void> {
  await call<void>('DELETE', `/teams/${teamId}/notion-integrations/${integrationId}`, undefined, {
    retry: false,
  })
}

export async function listSecureframeTests(
  teamId: string,
  integrationId: string,
  failingOnly = true,
): Promise<SecureframeTest[]> {
  const data = await call<{ tests: SecureframeTest[] }>(
    'GET',
    `/teams/${teamId}/secureframe-integrations/${integrationId}/tests?failingOnly=${failingOnly ? 'true' : 'false'}`,
  )

  return data.tests ?? []
}

export async function listVantaTests(
  teamId: string,
  integrationId: string,
  opts: { status?: string; infraOnly?: boolean } = {},
): Promise<VantaTest[]> {
  const params = new URLSearchParams()

  if (opts.status) params.set('status', opts.status)
  if (opts.infraOnly) params.set('infraOnly', 'true')
  const qs = params.toString()
  const query = qs ? `?${qs}` : ''
  const data = await call<{ tests: VantaTest[] }>(
    'GET',
    `/teams/${teamId}/vanta-integrations/${integrationId}/tests${query}`,
  )

  return data.tests ?? []
}
