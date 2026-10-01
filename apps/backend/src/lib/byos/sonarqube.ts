import { SonarqubeApiError } from './sonarqube-network'
import { defaultRequestDependencies, sonarqubeRequest } from './sonarqube-request'

import type { SonarqubeCredentials, SonarqubeRequestDependencies } from './sonarqube-request'

export {
  blockedSonarqubeBaseUrlReason,
  resolvePublicSonarqubeTarget,
  SonarqubeApiError,
} from './sonarqube-network'
export type { SonarqubeResolvedTarget } from './sonarqube-network'
export {
  credentialsFromSonarqubeBinding,
  sonarqubeRequest,
  verifySonarqubeCredentials,
} from './sonarqube-request'
export type { SonarqubeCredentials, SonarqubeRequestDependencies } from './sonarqube-request'

function pageQuery(page: number, pageSize: number): URLSearchParams {
  return new URLSearchParams({ p: String(page), ps: String(pageSize) })
}

export async function listSonarqubeProjects(
  credentials: SonarqubeCredentials,
  params: { page: number; pageSize: number; query?: string },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const query = pageQuery(params.page, params.pageSize)

  query.set('qualifiers', 'TRK')
  if (params.query) query.set('q', params.query)

  return await sonarqubeRequest<{
    paging?: { pageIndex: number; pageSize: number; total: number }
    components?: Record<string, unknown>[]
  }>(credentials, '/api/components/search', { query }, dependencies)
}

export async function listSonarqubeIssues(
  credentials: SonarqubeCredentials,
  params: {
    projectKey: string
    page: number
    pageSize: number
    branch?: string
    pullRequest?: string
    resolved?: boolean
    types?: string
    severities?: string
  },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const query = pageQuery(params.page, params.pageSize)

  query.set('componentKeys', params.projectKey)
  query.set('resolved', String(params.resolved ?? false))
  if (params.branch) query.set('branch', params.branch)
  if (params.pullRequest) query.set('pullRequest', params.pullRequest)
  if (params.types) query.set('types', params.types)
  if (params.severities) query.set('severities', params.severities)

  return await sonarqubeRequest<Record<string, unknown>>(
    credentials,
    '/api/issues/search',
    {
      query,
    },
    dependencies,
  )
}

export async function listSonarqubeHotspots(
  credentials: SonarqubeCredentials,
  params: {
    projectKey: string
    page: number
    pageSize: number
    branch?: string
    pullRequest?: string
    status?: string
  },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const query = pageQuery(params.page, params.pageSize)

  query.set('projectKey', params.projectKey)
  if (params.branch) query.set('branch', params.branch)
  if (params.pullRequest) query.set('pullRequest', params.pullRequest)
  if (params.status) query.set('status', params.status)

  return await sonarqubeRequest<Record<string, unknown>>(
    credentials,
    '/api/hotspots/search',
    {
      query,
    },
    dependencies,
  )
}

export async function getSonarqubeQualityGate(
  credentials: SonarqubeCredentials,
  params: { projectKey: string; branch?: string; pullRequest?: string },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const query = new URLSearchParams({ projectKey: params.projectKey })

  if (params.branch) query.set('branch', params.branch)
  if (params.pullRequest) query.set('pullRequest', params.pullRequest)

  return await sonarqubeRequest<Record<string, unknown>>(
    credentials,
    '/api/qualitygates/project_status',
    { query },
    dependencies,
  )
}

const DEFAULT_REPORT_METRICS = [
  'bugs',
  'vulnerabilities',
  'code_smells',
  'security_hotspots',
  'security_hotspots_reviewed',
  'coverage',
  'duplicated_lines_density',
  'reliability_rating',
  'security_rating',
  'sqale_rating',
  'ncloc',
].join(',')

export async function getSonarqubeMeasures(
  credentials: SonarqubeCredentials,
  params: { projectKey: string; branch?: string; pullRequest?: string },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const query = new URLSearchParams({
    component: params.projectKey,
    metricKeys: DEFAULT_REPORT_METRICS,
    additionalFields: 'metrics',
  })

  if (params.branch) query.set('branch', params.branch)
  if (params.pullRequest) query.set('pullRequest', params.pullRequest)

  return await sonarqubeRequest<Record<string, unknown>>(
    credentials,
    '/api/measures/component',
    {
      query,
    },
    dependencies,
  )
}

export async function listSonarqubeAnalyses(
  credentials: SonarqubeCredentials,
  params: { projectKey: string; pageSize?: number; branch?: string },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const query = new URLSearchParams({
    project: params.projectKey,
    p: '1',
    ps: String(params.pageSize ?? 20),
  })

  if (params.branch) query.set('branch', params.branch)

  return await sonarqubeRequest<Record<string, unknown>>(
    credentials,
    '/api/project_analyses/search',
    { query },
    dependencies,
  )
}

export async function getSonarqubeTask(
  credentials: SonarqubeCredentials,
  taskId: string,
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  return await sonarqubeRequest<Record<string, unknown>>(
    credentials,
    '/api/ce/task',
    {
      query: new URLSearchParams({ id: taskId }),
    },
    dependencies,
  )
}

export async function getSonarqubeProjectReport(
  credentials: SonarqubeCredentials,
  params: { projectKey: string; branch?: string; pullRequest?: string },
  dependencies: SonarqubeRequestDependencies = defaultRequestDependencies,
) {
  const scope = {
    projectKey: params.projectKey,
    ...(params.branch ? { branch: params.branch } : {}),
    ...(params.pullRequest ? { pullRequest: params.pullRequest } : {}),
  }
  const [qualityGate, measures, issues, hotspots, analyses] = await Promise.all([
    getSonarqubeQualityGate(credentials, scope, dependencies),
    getSonarqubeMeasures(credentials, scope, dependencies),
    listSonarqubeIssues(
      credentials,
      { ...scope, page: 1, pageSize: 100, resolved: false },
      dependencies,
    ),
    listSonarqubeHotspots(credentials, { ...scope, page: 1, pageSize: 100 }, dependencies).catch(
      (err: unknown) => {
        // Hotspots are absent/forbidden on some versions or permission sets. Keep
        // the rest of the report useful and expose the capability error clearly.
        if (err instanceof SonarqubeApiError && (err.status === 403 || err.status === 404)) {
          return { unavailable: true, error: err.message }
        }
        throw err
      },
    ),
    listSonarqubeAnalyses(
      credentials,
      {
        projectKey: params.projectKey,
        pageSize: 20,
        ...(params.branch ? { branch: params.branch } : {}),
      },
      dependencies,
    ),
  ])

  return {
    projectKey: params.projectKey,
    branch: params.branch ?? null,
    pullRequest: params.pullRequest ?? null,
    generatedAt: new Date().toISOString(),
    qualityGate,
    measures,
    issues,
    hotspots,
    analyses,
  }
}
