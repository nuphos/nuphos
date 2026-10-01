import { gcpFetch } from './gcp-cloud-run-http'
import { mapRevision, mapService } from './gcp-cloud-run-mapping'
import { ensureConfigured } from './gcp-compute-shared'

import type { GcpHandle } from './gcp'
import type {
  GcpCloudRunRevision,
  GcpCloudRunService,
  RawRevision,
  RawService,
} from './gcp-cloud-run-mapping'

export type { GcpUpstreamError } from './gcp-cloud-run-http'
export type { GcpCloudRunRevision, GcpCloudRunService } from './gcp-cloud-run-mapping'

export async function listCloudRunServices(handle: GcpHandle): Promise<GcpCloudRunService[]> {
  ensureConfigured()
  const base = `https://run.googleapis.com/v2/projects/${handle.projectId}/locations/-/services?pageSize=500`
  const all: RawService[] = []
  let pageToken: string | undefined

  do {
    const url = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base
    const data = (await gcpFetch(handle, url)) as {
      services?: RawService[]
      nextPageToken?: string
    }

    all.push(...(data.services ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)

  return all
    .map(mapService)
    .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name))
}

export async function getCloudRunService(
  handle: GcpHandle,
  region: string,
  name: string,
): Promise<GcpCloudRunService | null> {
  ensureConfigured()
  const url = `https://run.googleapis.com/v2/projects/${handle.projectId}/locations/${region}/services/${name}`

  try {
    const data = (await gcpFetch(handle, url)) as RawService

    return mapService(data)
  } catch (e) {
    if ((e as { code?: number }).code === 5) return null
    throw e
  }
}

export async function listCloudRunRevisions(
  handle: GcpHandle,
  region: string,
  serviceName: string,
): Promise<GcpCloudRunRevision[]> {
  ensureConfigured()
  const base = `https://run.googleapis.com/v2/projects/${handle.projectId}/locations/${region}/services/${serviceName}/revisions?pageSize=100`
  const all: RawRevision[] = []
  let pageToken: string | undefined

  do {
    const url = pageToken ? `${base}&pageToken=${encodeURIComponent(pageToken)}` : base
    const data = (await gcpFetch(handle, url)) as {
      revisions?: RawRevision[]
      nextPageToken?: string
    }

    all.push(...(data.revisions ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)

  return all.map((r) => mapRevision(r, serviceName, region))
}
