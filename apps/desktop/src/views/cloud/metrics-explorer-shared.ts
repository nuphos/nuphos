export const METRIC_STATS = ['Average', 'Sum', 'Maximum', 'Minimum'] as const

export type MetricStat = (typeof METRIC_STATS)[number]

export const EXPLORER_MAX_SERIES = 8

export function dimensionsLabel(dims: Record<string, string>): string {
  const entries = Object.entries(dims)

  if (entries.length === 0) return '(no dimensions)'

  return entries.map(([k, v]) => `${k}=${v}`).join(', ')
}

export { formatLogTimestamp, LOG_RANGE_OPTIONS } from './log-helpers'

// Every commercial (aws partition) region, enabled-by-default and opt-in
// alike — regions the account hasn't opted into just yield an empty/erroring
// metrics view. Source: https://docs.aws.amazon.com/general/latest/gr/rande.html
// The list is a snapshot valid as of 2026-07-23; update it when AWS launches
// a region.
export const AWS_REGIONS: readonly string[] = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'ca-west-1',
  'mx-central-1',
  'sa-east-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'eu-south-1',
  'eu-south-2',
  'il-central-1',
  'me-south-1',
  'me-central-1',
  'af-south-1',
  'ap-east-1',
  'ap-east-2',
  'ap-south-1',
  'ap-south-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-southeast-5',
  'ap-southeast-6',
  'ap-southeast-7',
]
