import type { AwsResourceDetailRef, CloudflareResourceDetailRef, PageLocation } from './types.ts'
import type { DetailTarget } from '../../views/DetailView'

// ---------------------------------------------------------------------------
// Producer: NavigationSnapshot → PageLocation.
// ---------------------------------------------------------------------------

export function pathSegment(value: string): string {
  return encodeURIComponent(value)
}

export function pageLocation(
  pathname: string,
  params?: Record<string, string | null | undefined>,
): PageLocation {
  const searchParams = new URLSearchParams()

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) searchParams.set(key, value)
  }
  const search = searchParams.toString()

  return {
    pathname,
    search,
    href: search ? `${pathname}?${search}` : pathname,
  }
}

export type SectionDef = {
  active: string
  segment: string
  /** Legacy inbound segments (old URLs) that parse to the same page; the
   *  producer only ever emits `segment`. */
  aliases?: string[]
  awsDetail?: AwsResourceDetailRef['kind']
  cloudflareDetail?: CloudflareResourceDetailRef['kind']
}

// One row per provider section page, serving both directions: the producer
// looks up active → segment, the parser segment/alias → active (plus the
// drill-down kind where the section has one).
const PROVIDER_SECTIONS: Record<string, SectionDef[]> = {
  aws: [
    { active: 'aws.vpcs', segment: 'vpcs' },
    { active: 'aws.nacls', segment: 'network-acls' },
    { active: 'aws.clusters', segment: 'eks-clusters' },
    { active: 'aws.ec2', segment: 'ec2-instances' },
    { active: 'aws.lightsail', segment: 'lightsail' },
    { active: 'aws.ecs', segment: 'ecs-clusters' },
    { active: 'aws.cloudformation', segment: 'cloudformation' },
    { active: 'aws.lambda', segment: 'lambda-functions', awsDetail: 'lambda' },
    { active: 'aws.cloudwatch', segment: 'log-groups', awsDetail: 'logGroup' },
    { active: 'aws.cloudwatch-alarms', segment: 'cloudwatch-alarms', awsDetail: 'alarm' },
    { active: 'aws.cloudwatch-metrics', segment: 'cloudwatch-metrics' },
    { active: 'aws.s3', segment: 's3-buckets' },
    { active: 'aws.iam', segment: 'iam' },
  ],
  gcp: [
    { active: 'gcp.vpcs', segment: 'vpcs' },
    { active: 'gcp.firewalls', segment: 'firewalls' },
    { active: 'gcp.clusters', segment: 'gke-clusters' },
    { active: 'gcp.gce', segment: 'gce-instances' },
    { active: 'gcp.cloudrun', segment: 'cloud-run' },
    { active: 'gcp.metrics', segment: 'metrics' },
    { active: 'gcp.dashboards', segment: 'dashboards' },
    { active: 'gcp.iam', segment: 'iam' },
  ],
  cloudflare: [
    { active: 'cloudflare.zones', segment: 'zones' },
    { active: 'cloudflare.dns', segment: 'dns-records' },
    { active: 'cloudflare.workers', segment: 'workers', cloudflareDetail: 'worker' },
    { active: 'cloudflare.r2', segment: 'r2', cloudflareDetail: 'r2' },
    { active: 'cloudflare.pages', segment: 'pages', cloudflareDetail: 'pages' },
    { active: 'cloudflare.d1', segment: 'd1', cloudflareDetail: 'd1' },
    { active: 'cloudflare.kv', segment: 'kv', cloudflareDetail: 'kv' },
    { active: 'cloudflare.iam', segment: 'iam' },
  ],
  // `clusters` is the pre-/k8s/ drill-down prefix: those URLs carry a cluster
  // name where the canonical route needs a provider cluster id, so they land on
  // the provider's cluster list instead of a dead end.
  linode: [
    { active: 'linode.instances', segment: 'instances', aliases: ['linode/instances'] },
    { active: 'linode.lke', segment: 'lke-clusters', aliases: ['linode/lke', 'clusters'] },
  ],
  hetzner: [{ active: 'hetzner.servers', segment: 'servers', aliases: ['hetzner/servers'] }],
  tencent: [
    { active: 'tencent.cvm', segment: 'cvm-instances' },
    {
      active: 'tencent.clusters',
      segment: 'tke-clusters',
      aliases: ['tencent/clusters', 'clusters'],
    },
  ],
  aliyun: [
    { active: 'aliyun.ecs', segment: 'ecs-instances' },
    { active: 'aliyun.swas', segment: 'swas-instances' },
    {
      active: 'aliyun.clusters',
      segment: 'ack-clusters',
      aliases: ['aliyun/clusters', 'clusters'],
    },
  ],
  volcengine: [
    { active: 'volcengine.ecs', segment: 'ecs-instances' },
    {
      active: 'volcengine.clusters',
      segment: 'vke-clusters',
      aliases: ['volcengine/clusters', 'clusters'],
    },
  ],
  betterstack: [
    { active: 'betterstack.monitors', segment: 'monitors' },
    { active: 'betterstack.incidents', segment: 'incidents' },
    { active: 'betterstack.sources', segment: 'sources' },
    { active: 'betterstack.dashboards', segment: 'dashboards' },
  ],
  'uptime-kuma': [{ active: 'uptime-kuma.monitors', segment: 'monitors' }],
  mongodb: [
    { active: 'database.overview', segment: 'overview' },
    { active: 'database.collections', segment: 'collections' },
    { active: 'database.query', segment: 'query' },
    { active: 'database.changes', segment: 'changes' },
    { active: 'database.monitoring', segment: 'monitoring' },
    { active: 'database.access', segment: 'access' },
    { active: 'database.audit', segment: 'audit' },
    { active: 'database.settings', segment: 'settings' },
  ],
  tailscale: [{ active: 'tailscale.devices', segment: 'devices', aliases: ['tailscale/devices'] }],
  zeabur: [
    { active: 'zeabur.projects', segment: 'projects' },
    { active: 'zeabur.servers', segment: 'servers' },
  ],
}

export function sectionSegment(provider: string, active: string): string {
  return (
    PROVIDER_SECTIONS[provider]?.find((s) => s.active === active)?.segment ??
    active.replace('.', '/')
  )
}

export function sectionForSegments(provider: string, segs: string[]): SectionDef | null {
  const defs = PROVIDER_SECTIONS[provider]

  if (!defs || !segs[0]) return null
  const twoSeg = segs.slice(0, 2).join('/')

  return (
    defs.find(
      (s) => s.segment === segs[0] || s.aliases?.includes(segs[0]) || s.aliases?.includes(twoSeg),
    ) ?? null
  )
}

export const ECS_CLUSTER_PAGES: readonly string[] = [
  'services',
  'tasks',
  'infrastructure',
  'metrics',
]

export function ecsClusterPageSegment(active: string): string {
  const page = active.startsWith('ecs.') ? active.slice('ecs.'.length) : ''

  return ECS_CLUSTER_PAGES.includes(page) ? page : 'services'
}

export function clusterPageSegment(active: string): string {
  switch (active) {
    case 'cluster.overview':
      return 'overview'
    case 'cluster.events':
      return 'events'
    case 'cluster.nodes':
      return 'nodes'
    case 'config.storage':
      return 'storage/storage-classes'
    case 'storage.storage-classes':
      return 'storage/storage-classes'
    case 'storage.persistent-volumes':
      return 'storage/persistent-volumes'
    case 'storage.persistent-volume-claims':
      return 'storage/persistent-volume-claims'
    case 'networking.endpoint-slices':
      return 'networking/endpoint-slices'
    case 'networking.network-policies':
      return 'networking/network-policies'
    default:
      return active.replace('.', '/')
  }
}

export function resourceTargetPath(target: DetailTarget): string {
  const name = pathSegment(target.name)

  if (!target.namespace) return `resources/${target.kind.toLowerCase()}/${name}`

  return `namespaces/${pathSegment(target.namespace)}/resources/${target.kind.toLowerCase()}/${name}`
}
