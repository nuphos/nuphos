import type { AwsLambdaFunction } from '../../types'

export function lambdaConsoleUrl(fn: AwsLambdaFunction): string {
  return `https://${fn.region}.console.aws.amazon.com/lambda/home?region=${encodeURIComponent(fn.region)}#/functions/${encodeURIComponent(fn.name)}`
}

export function lambdaStateClass(state: string | null): string {
  if (state === 'Active') return 'text-status-success'
  if (state === 'Failed') return 'text-error'
  if (state === 'Pending' || state === 'Inactive') return 'text-status-warning'

  return 'text-secondary'
}
