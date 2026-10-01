export type GcpCloudRunService = {
  name: string
  region: string
  status: string
  url: string | null
  serviceAccountEmail: string | null
  ingress: string | null
  latestReadyRevision: string | null
  latestCreatedRevision: string | null
  creator: string | null
  traffic: { percent: number; revision: string | null; tag: string | null; type: string | null }[]
  conditions: { type: string; state: string; message: string | null }[]
  createdAt: string | null
  updatedAt: string | null
}

export type GcpCloudRunRevision = {
  name: string
  service: string
  region: string
  image: string | null
  cpu: string | null
  memory: string | null
  maxInstances: number | null
  minInstances: number | null
  serviceAccountEmail: string | null
  conditions: { type: string; state: string; message: string | null }[]
  createdAt: string | null
}

function lastSegment(name: string | null | undefined): string {
  if (!name) return ''
  const i = name.lastIndexOf('/')

  return i === -1 ? name : name.slice(i + 1)
}

function regionFromResourceName(name: string): string {
  const m = /\/locations\/([^/]+)\//.exec(name)

  return m ? m[1]! : ''
}

type RawCondition = {
  type?: string
  state?: string
  message?: string
}

type RawTraffic = {
  percent?: number
  revision?: string
  tag?: string
  type?: string
}

export type RawService = {
  name?: string
  uri?: string
  template?: {
    serviceAccount?: string
    containers?: { image?: string; resources?: { limits?: { cpu?: string; memory?: string } } }[]
    scaling?: { maxInstanceCount?: number; minInstanceCount?: number }
  }
  ingress?: string
  latestReadyRevision?: string
  latestCreatedRevision?: string
  creator?: string
  traffic?: RawTraffic[]
  terminalCondition?: RawCondition
  conditions?: RawCondition[]
  createTime?: string
  updateTime?: string
  reconciling?: boolean
}

export type RawRevision = {
  name?: string
  serviceAccount?: string
  containers?: { image?: string; resources?: { limits?: { cpu?: string; memory?: string } } }[]
  scaling?: { maxInstanceCount?: number; minInstanceCount?: number }
  conditions?: RawCondition[]
  createTime?: string
}

function mapConditions(raw?: RawCondition[]): GcpCloudRunService['conditions'] {
  return (raw ?? []).map((c) => ({
    type: c.type ?? '',
    state: c.state ?? '',
    message: c.message ?? null,
  }))
}

function statusFromCondition(condition: RawCondition | undefined): string | null {
  switch (condition?.state) {
    case 'CONDITION_SUCCEEDED':
      return 'Ready'
    case 'CONDITION_FAILED':
      return 'Failed'
    case 'CONDITION_RECONCILING':
      return 'Reconciling'
    case 'CONDITION_PENDING':
      return 'Pending'
    case undefined:
    default:
      return null
  }
}

function serviceStatus(s: RawService): string {
  if (s.reconciling) return 'Reconciling'

  return (
    statusFromCondition(s.terminalCondition) ??
    statusFromCondition(s.conditions?.find((c) => c.type === 'Ready')) ??
    'Unknown'
  )
}

export function mapService(s: RawService): GcpCloudRunService {
  const fullName = s.name ?? ''

  return {
    name: lastSegment(fullName),
    region: regionFromResourceName(fullName),
    status: serviceStatus(s),
    url: s.uri ?? null,
    serviceAccountEmail: s.template?.serviceAccount ?? null,
    ingress: s.ingress ?? null,
    latestReadyRevision: lastSegment(s.latestReadyRevision) || null,
    latestCreatedRevision: lastSegment(s.latestCreatedRevision) || null,
    creator: s.creator ?? null,
    traffic: (s.traffic ?? []).map((t) => ({
      percent: t.percent ?? 0,
      revision: lastSegment(t.revision) || null,
      tag: t.tag ?? null,
      type: t.type ?? null,
    })),
    conditions: mapConditions(s.conditions),
    createdAt: s.createTime ?? null,
    updatedAt: s.updateTime ?? null,
  }
}

export function mapRevision(
  r: RawRevision,
  serviceName: string,
  region: string,
): GcpCloudRunRevision {
  const container = r.containers?.[0]

  return {
    name: lastSegment(r.name),
    service: serviceName,
    region,
    image: container?.image ?? null,
    cpu: container?.resources?.limits?.cpu ?? null,
    memory: container?.resources?.limits?.memory ?? null,
    maxInstances: r.scaling?.maxInstanceCount ?? null,
    minInstances: r.scaling?.minInstanceCount ?? null,
    serviceAccountEmail: r.serviceAccount ?? null,
    conditions: mapConditions(r.conditions),
    createdAt: r.createTime ?? null,
  }
}
