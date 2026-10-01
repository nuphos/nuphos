import { cloudflareRequest } from './cloudflare'

import type { CloudflareAccountHandle } from './cloudflare'

export type CloudflareWorkerScript = {
  name: string
  usageModel: string | null
  createdOn: string | null
  modifiedOn: string | null
}

export type CloudflareWorkerBinding = {
  type: string
  name: string
  /** Best-effort human-readable target (namespace id, bucket name, service, …). */
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

type WorkerScriptRaw = {
  id: string
  usage_model?: string
  created_on?: string
  modified_on?: string
}

function acct(handle: CloudflareAccountHandle): string {
  return encodeURIComponent(handle.accountId)
}

export async function listWorkerScripts(
  handle: CloudflareAccountHandle,
): Promise<CloudflareWorkerScript[]> {
  const scripts = await cloudflareRequest<WorkerScriptRaw[]>(
    handle,
    `/accounts/${acct(handle)}/workers/scripts`,
  )

  return (scripts ?? []).map((s) => ({
    name: s.id,
    usageModel: s.usage_model ?? null,
    createdOn: s.created_on ?? null,
    modifiedOn: s.modified_on ?? null,
  }))
}

function bindingTarget(b: Record<string, unknown>): string | null {
  const candidate =
    b.namespace_id ??
    b.bucket_name ??
    b.service ??
    b.database_id ??
    b.queue_name ??
    b.id ??
    b.text ??
    null

  return typeof candidate === 'string' ? candidate : null
}

export async function getWorkerSettings(
  handle: CloudflareAccountHandle,
  scriptName: string,
): Promise<CloudflareWorkerSettings> {
  const settings = await cloudflareRequest<{
    compatibility_date?: string
    compatibility_flags?: string[]
    usage_model?: string
    observability?: { enabled?: boolean }
    bindings?: Record<string, unknown>[]
  }>(handle, `/accounts/${acct(handle)}/workers/scripts/${encodeURIComponent(scriptName)}/settings`)

  return {
    compatibilityDate: settings.compatibility_date ?? null,
    compatibilityFlags: settings.compatibility_flags ?? [],
    usageModel: settings.usage_model ?? null,
    observabilityEnabled: settings.observability?.enabled ?? null,
    bindings: (settings.bindings ?? []).map((b) => ({
      type: typeof b.type === 'string' ? b.type : 'unknown',
      name: typeof b.name === 'string' ? b.name : '',
      target: bindingTarget(b),
    })),
  }
}

export async function listWorkerCronTriggers(
  handle: CloudflareAccountHandle,
  scriptName: string,
): Promise<CloudflareWorkerCronTrigger[]> {
  const result = await cloudflareRequest<{
    schedules?: { cron: string; created_on?: string; modified_on?: string }[]
  }>(
    handle,
    `/accounts/${acct(handle)}/workers/scripts/${encodeURIComponent(scriptName)}/schedules`,
  )

  return (result.schedules ?? []).map((s) => ({
    cron: s.cron,
    createdOn: s.created_on ?? null,
    modifiedOn: s.modified_on ?? null,
  }))
}

export async function updateWorkerCronTriggers(
  handle: CloudflareAccountHandle,
  scriptName: string,
  crons: string[],
): Promise<CloudflareWorkerCronTrigger[]> {
  const result = await cloudflareRequest<{
    schedules?: { cron: string; created_on?: string; modified_on?: string }[]
  }>(
    handle,
    `/accounts/${acct(handle)}/workers/scripts/${encodeURIComponent(scriptName)}/schedules`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(crons.map((cron) => ({ cron }))),
    },
  )

  return (result.schedules ?? []).map((s) => ({
    cron: s.cron,
    createdOn: s.created_on ?? null,
    modifiedOn: s.modified_on ?? null,
  }))
}

export async function listWorkerDeployments(
  handle: CloudflareAccountHandle,
  scriptName: string,
): Promise<CloudflareWorkerDeployment[]> {
  const result = await cloudflareRequest<{
    deployments?: {
      id: string
      source?: string
      author_email?: string
      created_on?: string
    }[]
  }>(
    handle,
    `/accounts/${acct(handle)}/workers/scripts/${encodeURIComponent(scriptName)}/deployments`,
  )

  return (result.deployments ?? []).map((d) => ({
    id: d.id,
    source: d.source ?? null,
    authorEmail: d.author_email ?? null,
    createdOn: d.created_on ?? null,
  }))
}

export async function getWorkerSubdomainEnabled(
  handle: CloudflareAccountHandle,
  scriptName: string,
): Promise<boolean | null> {
  const result = await cloudflareRequest<{ enabled?: boolean }>(
    handle,
    `/accounts/${acct(handle)}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`,
  )

  return result.enabled ?? null
}

export async function listWorkerDomains(
  handle: CloudflareAccountHandle,
): Promise<CloudflareWorkerDomain[]> {
  const domains = await cloudflareRequest<
    {
      id: string
      hostname: string
      zone_name?: string
      service?: string
      environment?: string
    }[]
  >(handle, `/accounts/${acct(handle)}/workers/domains`)

  return (domains ?? []).map((d) => ({
    id: d.id,
    hostname: d.hostname,
    zoneName: d.zone_name ?? null,
    service: d.service ?? null,
    environment: d.environment ?? null,
  }))
}

export async function deleteWorkerScript(
  handle: CloudflareAccountHandle,
  scriptName: string,
): Promise<void> {
  await cloudflareRequest<unknown>(
    handle,
    `/accounts/${acct(handle)}/workers/scripts/${encodeURIComponent(scriptName)}?force=true`,
    { method: 'DELETE' },
  )
}
