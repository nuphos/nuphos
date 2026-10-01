import { cfBase } from './cf-dns'
import { call } from './client'

export type CloudflarePagesDeploymentSummary = {
  id: string
  shortId: string | null
  environment: string | null
  url: string | null
  createdOn: string | null
  modifiedOn: string | null
  stageName: string | null
  stageStatus: string | null
  branch: string | null
  commitHash: string | null
  commitMessage: string | null
}

export type CloudflarePagesProject = {
  id: string | null
  name: string
  subdomain: string | null
  domains: string[]
  productionBranch: string | null
  source: string | null
  createdOn: string | null
  latestDeployment: CloudflarePagesDeploymentSummary | null
}

export type CloudflarePagesDomain = {
  id: string | null
  name: string
  status: string | null
}

export type CloudflarePagesLogLine = {
  ts: string | null
  line: string
}

export async function listCloudflarePagesProjects(
  teamId: string,
  accountId: string,
): Promise<CloudflarePagesProject[]> {
  const data = await call<{ projects: CloudflarePagesProject[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/pages/projects`,
  )

  return data.projects ?? []
}

export async function getCloudflarePagesProject(
  teamId: string,
  accountId: string,
  projectName: string,
): Promise<CloudflarePagesProject> {
  return call<CloudflarePagesProject>(
    'GET',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
  )
}

export async function deleteCloudflarePagesProject(
  teamId: string,
  accountId: string,
  projectName: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
  )
}

export async function listCloudflarePagesDeployments(
  teamId: string,
  accountId: string,
  projectName: string,
): Promise<CloudflarePagesDeploymentSummary[]> {
  const data = await call<{ deployments: CloudflarePagesDeploymentSummary[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
  )

  return data.deployments ?? []
}

export async function createCloudflarePagesDeployment(
  teamId: string,
  accountId: string,
  projectName: string,
  branch?: string,
): Promise<CloudflarePagesDeploymentSummary> {
  return call<CloudflarePagesDeploymentSummary>(
    'POST',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
    branch ? { branch } : {},
    { retry: false },
  )
}

export async function retryCloudflarePagesDeployment(
  teamId: string,
  accountId: string,
  projectName: string,
  deploymentId: string,
): Promise<CloudflarePagesDeploymentSummary> {
  return call<CloudflarePagesDeploymentSummary>(
    'POST',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/deployments/${encodeURIComponent(deploymentId)}/retry`,
    undefined,
    { retry: false },
  )
}

export async function rollbackCloudflarePagesDeployment(
  teamId: string,
  accountId: string,
  projectName: string,
  deploymentId: string,
): Promise<CloudflarePagesDeploymentSummary> {
  return call<CloudflarePagesDeploymentSummary>(
    'POST',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
    undefined,
    { retry: false },
  )
}

export async function getCloudflarePagesDeploymentLogs(
  teamId: string,
  accountId: string,
  projectName: string,
  deploymentId: string,
): Promise<CloudflarePagesLogLine[]> {
  const data = await call<{ logs: CloudflarePagesLogLine[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/deployments/${encodeURIComponent(deploymentId)}/logs`,
  )

  return data.logs ?? []
}

export async function listCloudflarePagesDomains(
  teamId: string,
  accountId: string,
  projectName: string,
): Promise<CloudflarePagesDomain[]> {
  const data = await call<{ domains: CloudflarePagesDomain[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
  )

  return data.domains ?? []
}

export async function addCloudflarePagesDomain(
  teamId: string,
  accountId: string,
  projectName: string,
  name: string,
): Promise<void> {
  await call<void>(
    'POST',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
    { name },
    { retry: false },
  )
}

export async function deleteCloudflarePagesDomain(
  teamId: string,
  accountId: string,
  projectName: string,
  name: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/domains/${encodeURIComponent(name)}`,
  )
}

// --- D1 --------------------------------------------------------------------
