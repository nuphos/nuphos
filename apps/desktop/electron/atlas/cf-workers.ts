import { cfBase } from './cf-dns'
import { call } from './client'

export type CloudflareWorkerScript = {
  name: string
  usageModel: string | null
  createdOn: string | null
  modifiedOn: string | null
}

export type CloudflareWorkerBinding = {
  type: string
  name: string
  target: string | null
}

export type CloudflareWorkerSettings = {
  compatibilityDate: string | null
  compatibilityFlags: string[]
  usageModel: string | null
  observabilityEnabled: boolean | null
  bindings: CloudflareWorkerBinding[]
}

export type CloudflareWorkerCronTrigger = {
  cron: string
  createdOn: string | null
  modifiedOn: string | null
}

export type CloudflareWorkerDeployment = {
  id: string
  source: string | null
  authorEmail: string | null
  createdOn: string | null
}

export type CloudflareWorkerDomain = {
  id: string
  hostname: string
  zoneName: string | null
  service: string | null
  environment: string | null
}

export async function listCloudflareWorkers(
  teamId: string,
  accountId: string,
): Promise<CloudflareWorkerScript[]> {
  const data = await call<{ scripts: CloudflareWorkerScript[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/workers/scripts`,
  )

  return data.scripts ?? []
}

export async function listCloudflareWorkerDomains(
  teamId: string,
  accountId: string,
): Promise<CloudflareWorkerDomain[]> {
  const data = await call<{ domains: CloudflareWorkerDomain[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/workers/domains`,
  )

  return data.domains ?? []
}

export async function getCloudflareWorkerSettings(
  teamId: string,
  accountId: string,
  scriptName: string,
): Promise<CloudflareWorkerSettings> {
  return call<CloudflareWorkerSettings>(
    'GET',
    `${cfBase(teamId, accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
  )
}

export async function listCloudflareWorkerCronTriggers(
  teamId: string,
  accountId: string,
  scriptName: string,
): Promise<CloudflareWorkerCronTrigger[]> {
  const data = await call<{ schedules: CloudflareWorkerCronTrigger[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/schedules`,
  )

  return data.schedules ?? []
}

export async function updateCloudflareWorkerCronTriggers(
  teamId: string,
  accountId: string,
  scriptName: string,
  crons: string[],
): Promise<CloudflareWorkerCronTrigger[]> {
  const data = await call<{ schedules: CloudflareWorkerCronTrigger[] }>(
    'PUT',
    `${cfBase(teamId, accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/schedules`,
    { crons },
  )

  return data.schedules ?? []
}

export async function listCloudflareWorkerDeployments(
  teamId: string,
  accountId: string,
  scriptName: string,
): Promise<CloudflareWorkerDeployment[]> {
  const data = await call<{ deployments: CloudflareWorkerDeployment[] }>(
    'GET',
    `${cfBase(teamId, accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/deployments`,
  )

  return data.deployments ?? []
}

export async function getCloudflareWorkerSubdomain(
  teamId: string,
  accountId: string,
  scriptName: string,
): Promise<boolean | null> {
  const data = await call<{ enabled: boolean | null }>(
    'GET',
    `${cfBase(teamId, accountId)}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`,
  )

  return data.enabled ?? null
}

export async function deleteCloudflareWorker(
  teamId: string,
  accountId: string,
  scriptName: string,
): Promise<void> {
  await call<void>(
    'DELETE',
    `${cfBase(teamId, accountId)}/workers/scripts/${encodeURIComponent(scriptName)}`,
  )
}

// --- R2 --------------------------------------------------------------------
