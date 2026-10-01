import { AppError } from '@/lib/errors'

type AwsErrorLike = {
  name?: string
  Code?: string
  code?: string
  message?: string
  $metadata?: { httpStatusCode?: number }
}

type RegionalListFailure = {
  region: string
  error: unknown
}

type RegionalListResult<T> = { ok: true; value: T[] } | { ok: false; failure: RegionalListFailure }

function awsErrorField(err: unknown, key: keyof AwsErrorLike): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const value = (err as AwsErrorLike)[key]

  return typeof value === 'string' ? value : undefined
}

export function isAwsAccessDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as AwsErrorLike
  const status = e.$metadata?.httpStatusCode
  const name = awsErrorField(err, 'name') ?? ''
  const code = awsErrorField(err, 'Code') ?? awsErrorField(err, 'code') ?? ''
  const message = awsErrorField(err, 'message') ?? ''

  return (
    status === 403 ||
    name === 'AccessDenied' ||
    name === 'AccessDeniedException' ||
    name === 'UnauthorizedOperation' ||
    code === 'AccessDenied' ||
    code === 'AccessDeniedException' ||
    code === 'UnauthorizedOperation' ||
    /\bnot authorized\b/i.test(message) ||
    /\baccess denied\b/i.test(message)
  )
}

function awsErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function collectAwsRegionalList<T>(
  regions: string[],
  operation: string,
  loadRegion: (region: string) => Promise<T[]>,
): Promise<T[]> {
  const results = await Promise.all<RegionalListResult<T>>(
    regions.map(async (region) => {
      try {
        return { ok: true, value: await loadRegion(region) }
      } catch (error) {
        return { ok: false, failure: { region, error } }
      }
    }),
  )

  const rows = results.flatMap((result) => (result.ok ? result.value : []))
  const failures = results.flatMap((result) => (result.ok ? [] : [result.failure]))

  if (failures.length === 0) return rows
  if (rows.length > 0) return rows

  const accessDenied = failures.find((failure) => isAwsAccessDeniedError(failure.error))

  if (accessDenied) {
    throw new AppError(
      403,
      'aws_role_permission_denied',
      `The selected AWS role does not have permission to ${operation}.`,
      {
        provider: 'aws',
        operation,
        regions: failures.map((failure) => failure.region),
        upstreamMessage: awsErrorMessage(accessDenied.error),
      },
    )
  }

  throw failures[0]!.error
}
