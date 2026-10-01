import { hashParts, pathSegment, pathSegments } from './url.ts'

import type { AwsAccount } from '../../types'

type AwsSection = { segment: string; detail?: string[] }

const SERVICE_SECTIONS: Record<string, string> = {
  ec2: 'ec2-instances',
  lightsail: 'lightsail',
  eks: 'eks-clusters',
  ecs: 'ecs-clusters',
  cloudformation: 'cloudformation',
  iam: 'iam',
  iamv2: 'iam',
}

/**
 * AWS console hashes percent-encode twice (`$252F` for a slash), so the inner
 * `%` has to be restored before the usual decode.
 */
function decodeHashToken(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replaceAll('$25', '%'))
  } catch {
    return null
  }
}

function regionForUrl(url: URL): string | null {
  const [subdomain] = url.hostname.toLowerCase().split('.')

  if (subdomain && subdomain !== 'console') return subdomain

  return url.searchParams.get('region') ?? hashParts(url).query.get('region')
}

function cloudwatchSection(url: URL, region: string | null): AwsSection {
  const hash = hashParts(url).path
  const [view, ...rest] = hash.split(':')
  const detailToken = rest.join(':').split('/').at(-1)
  const name = detailToken ? decodeHashToken(detailToken) : null

  if (view === 'alarmsV2') {
    return name && region
      ? { segment: 'cloudwatch-alarms', detail: [region, name] }
      : { segment: 'cloudwatch-alarms' }
  }
  if (view === 'metricsV2') return { segment: 'cloudwatch-metrics' }

  // A log-group link is the common case; the CloudWatch home page has no
  // equivalent landing spot, and log groups is what the app's section shows.
  return name && region && rest.join(':').includes('log-group/')
    ? { segment: 'log-groups', detail: [region, name] }
    : { segment: 'log-groups' }
}

function lambdaSection(url: URL, region: string | null): AwsSection {
  const [, name] = /^\/functions\/([^/]+)/.exec(hashParts(url).path) ?? []
  const decoded = name ? decodeHashToken(name) : null

  return decoded && region
    ? { segment: 'lambda-functions', detail: [region, decoded] }
    : { segment: 'lambda-functions' }
}

function s3Section(segs: string[], url: URL): AwsSection {
  const bucket = segs[0] === 'buckets' && segs[1] ? segs[1] : null

  if (!bucket) return { segment: 's3-buckets' }
  const prefix = url.searchParams.get('prefix')
  const prefixSegs = prefix ? prefix.replace(/\/$/, '').split('/').filter(Boolean) : []

  return { segment: 's3-buckets', detail: [bucket, ...prefixSegs] }
}

function sectionForUrl(url: URL): AwsSection | null {
  const segs = pathSegments(url)

  if (!segs) return null
  const [service, ...rest] = segs

  if (!service) return null
  const region = regionForUrl(url)

  if (service === 'cloudwatch') return cloudwatchSection(url, region)
  if (service === 'lambda') return lambdaSection(url, region)
  if (service === 's3') return s3Section(rest, url)
  if (service === 'vpc') {
    const hash = hashParts(url).path

    return { segment: hash.startsWith('NetworkAcls') ? 'network-acls' : 'vpcs' }
  }
  const segment = SERVICE_SECTIONS[service]

  return segment ? { segment } : null
}

/**
 * Console URLs never carry the account id on their own, so the binding is named
 * by an account id somewhere in the link (an ARN, a switch-role query) and
 * otherwise by the team having exactly one AWS account bound.
 */
function accountIdForUrl(url: URL, accounts: readonly AwsAccount[]): string | null {
  const bound = [...new Set(accounts.map((account) => account.accountId))]
  const mentioned = new Set(url.href.match(/\d{12}/g) ?? [])
  const named = bound.filter((accountId) => mentioned.has(accountId))

  if (named.length === 1) return named[0] ?? null

  return bound.length === 1 ? (bound[0] ?? null) : null
}

export function awsAppPath(
  teamId: string,
  accounts: readonly AwsAccount[],
  url: URL,
): string | null {
  const hostname = url.hostname.toLowerCase()

  if (url.protocol !== 'https:') return null
  if (hostname !== 'console.aws.amazon.com' && !hostname.endsWith('.console.aws.amazon.com')) {
    return null
  }
  const section = sectionForUrl(url)
  const accountId = accountIdForUrl(url, accounts)

  if (!section || !accountId) return null
  const detail = section.detail?.length ? `/${section.detail.map(pathSegment).join('/')}` : ''

  return `/teams/${pathSegment(teamId)}/infra/aws/${pathSegment(accountId)}/${section.segment}${detail}`
}
