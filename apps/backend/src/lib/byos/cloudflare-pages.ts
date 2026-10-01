import { cloudflarePaginatedRequest, cloudflareRequest } from './cloudflare'

import type { CloudflareAccountHandle } from './cloudflare'

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

type PagesDeploymentRaw = {
  id: string
  short_id?: string
  environment?: string
  url?: string
  created_on?: string
  modified_on?: string
  latest_stage?: { name?: string; status?: string }
  deployment_trigger?: {
    metadata?: { commit_hash?: string; commit_message?: string; branch?: string }
  }
}

type PagesProjectRaw = {
  id?: string
  name: string
  subdomain?: string
  domains?: string[]
  production_branch?: string
  source?: { type?: string }
  created_on?: string
  latest_deployment?: PagesDeploymentRaw
}

function acct(handle: CloudflareAccountHandle): string {
  return encodeURIComponent(handle.accountId)
}

function mapDeployment(d: PagesDeploymentRaw): CloudflarePagesDeploymentSummary {
  const meta = d.deployment_trigger?.metadata

  return {
    id: d.id,
    shortId: d.short_id ?? null,
    environment: d.environment ?? null,
    url: d.url ?? null,
    createdOn: d.created_on ?? null,
    modifiedOn: d.modified_on ?? null,
    stageName: d.latest_stage?.name ?? null,
    stageStatus: d.latest_stage?.status ?? null,
    branch: meta?.branch ?? null,
    commitHash: meta?.commit_hash ?? null,
    commitMessage: meta?.commit_message ?? null,
  }
}

function mapProject(p: PagesProjectRaw): CloudflarePagesProject {
  return {
    id: p.id ?? null,
    name: p.name,
    subdomain: p.subdomain ?? null,
    domains: p.domains ?? [],
    productionBranch: p.production_branch ?? null,
    source: p.source?.type ?? null,
    createdOn: p.created_on ?? null,
    latestDeployment: p.latest_deployment ? mapDeployment(p.latest_deployment) : null,
  }
}

export async function listPagesProjects(
  handle: CloudflareAccountHandle,
): Promise<CloudflarePagesProject[]> {
  // The Pages projects endpoint returns every project in one response and
  // rejects page/per_page ("Invalid list options provided"), so unlike
  // deployments it must NOT go through the paginated helper.
  const projects = await cloudflareRequest<PagesProjectRaw[]>(
    handle,
    `/accounts/${acct(handle)}/pages/projects`,
  )

  return (projects ?? []).map(mapProject)
}

export async function getPagesProject(
  handle: CloudflareAccountHandle,
  projectName: string,
): Promise<CloudflarePagesProject> {
  const project = await cloudflareRequest<PagesProjectRaw>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(projectName)}`,
  )

  return mapProject(project)
}

export async function deletePagesProject(
  handle: CloudflareAccountHandle,
  projectName: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(projectName)}`,
    { method: 'DELETE' },
  )
}

export async function listPagesDeployments(
  handle: CloudflareAccountHandle,
  projectName: string,
): Promise<CloudflarePagesDeploymentSummary[]> {
  const params = new URLSearchParams({ per_page: '25' })
  const deployments = await cloudflarePaginatedRequest<PagesDeploymentRaw>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
    params,
  )

  return deployments.map(mapDeployment)
}

export async function createPagesDeployment(
  handle: CloudflareAccountHandle,
  projectName: string,
  branch?: string,
): Promise<CloudflarePagesDeploymentSummary> {
  const body = branch ? JSON.stringify({ branch }) : undefined
  const deployment = await cloudflareRequest<PagesDeploymentRaw>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(projectName)}/deployments`,
    {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
    },
  )

  return mapDeployment(deployment)
}

export async function retryPagesDeployment(
  handle: CloudflareAccountHandle,
  projectName: string,
  deploymentId: string,
): Promise<CloudflarePagesDeploymentSummary> {
  const deployment = await cloudflareRequest<PagesDeploymentRaw>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/deployments/${encodeURIComponent(deploymentId)}/retry`,
    { method: 'POST' },
  )

  return mapDeployment(deployment)
}

export async function rollbackPagesDeployment(
  handle: CloudflareAccountHandle,
  projectName: string,
  deploymentId: string,
): Promise<CloudflarePagesDeploymentSummary> {
  const deployment = await cloudflareRequest<PagesDeploymentRaw>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/deployments/${encodeURIComponent(deploymentId)}/rollback`,
    { method: 'POST' },
  )

  return mapDeployment(deployment)
}

export async function getPagesDeploymentLogs(
  handle: CloudflareAccountHandle,
  projectName: string,
  deploymentId: string,
): Promise<CloudflarePagesLogLine[]> {
  const result = await cloudflareRequest<{
    data?: { ts?: string; line?: string }[]
  }>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/deployments/${encodeURIComponent(deploymentId)}/history/logs`,
  )

  return (result.data ?? []).map((l) => ({ ts: l.ts ?? null, line: l.line ?? '' }))
}

export async function listPagesDomains(
  handle: CloudflareAccountHandle,
  projectName: string,
): Promise<CloudflarePagesDomain[]> {
  const domains = await cloudflareRequest<{ id?: string; name: string; status?: string }[]>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
  )

  return (domains ?? []).map((d) => ({
    id: d.id ?? null,
    name: d.name,
    status: d.status ?? null,
  }))
}

export async function addPagesDomain(
  handle: CloudflareAccountHandle,
  projectName: string,
  name: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
}

export async function deletePagesDomain(
  handle: CloudflareAccountHandle,
  projectName: string,
  name: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/pages/projects/${encodeURIComponent(
      projectName,
    )}/domains/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  )
}
