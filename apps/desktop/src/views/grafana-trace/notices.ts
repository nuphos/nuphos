import { t } from '../../i18n/index.ts'

export type TraceNotice = {
  title: string
  detail?: string
}

const EXAMPLE_QUERY = '`{ resource.service.name = "api" }`'

export function validateTraceQuery(value: string): TraceNotice | null {
  if (!value) return null
  if (isTraceId(value)) return null
  if (/^[a-f0-9]+$/i.test(value)) {
    return {
      title: t('That looks like a trace ID, but it is not the right length.'),
      detail: t('Trace IDs are usually 16 or 32 hexadecimal characters.'),
    }
  }
  if (!looksLikeTraceQl(value)) {
    return {
      title: t('Enter a TraceQL query or paste a trace ID.'),
      detail: t(
        'Try {empty} to list recent traces, {example}, or a 16/32-character hex trace ID.',
        { empty: '`{}`', example: EXAMPLE_QUERY },
      ),
    }
  }

  return null
}

function looksLikeTraceQl(value: string): boolean {
  const trimmed = value.trim()

  return (
    trimmed === '{}' ||
    trimmed.startsWith('{') ||
    trimmed.includes('{') ||
    trimmed.startsWith('traceql:') ||
    trimmed.startsWith('rate(') ||
    trimmed.startsWith('histogram_')
  )
}

export function formatTraceError(error: unknown, mode: 'search' | 'trace'): TraceNotice {
  const message = String(error instanceof Error ? error.message : error)
  const downstream = extractDownstreamError(message)
  const detail = downstream || cleanupErrorMessage(message)

  if (/not found/i.test(detail) || /failed to get trace/i.test(detail)) {
    return {
      title: t('No trace found for that ID.'),
      detail:
        mode === 'trace'
          ? t('I tried the selected range and wider ranges up to 7 days.')
          : undefined,
    }
  }

  if (
    /bad request/i.test(detail) ||
    /parse error/i.test(detail) ||
    /syntax/i.test(detail) ||
    /failed to execute search query/i.test(detail)
  ) {
    return {
      title: t('That TraceQL query is not valid.'),
      detail: t('Try {empty} to list recent traces, or use a filter like {example}.', {
        empty: '`{}`',
        example: EXAMPLE_QUERY,
      }),
    }
  }

  return {
    title:
      mode === 'trace' ? t('Could not open that trace.') : t('Could not run that TraceQL query.'),
    detail,
  }
}

function extractDownstreamError(message: string): string | null {
  const jsonStart = message.indexOf('{')

  if (jsonStart < 0) return null
  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as {
      results?: Record<string, { error?: string; status?: number }>
      error?: { message?: string }
    }
    const resultError = Object.values(parsed.results ?? {}).find((x) => x?.error)?.error

    return resultError || parsed.error?.message || null
  } catch {
    return null
  }
}

function cleanupErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export function isTraceId(value: string): boolean {
  return /^(?:[a-f0-9]{16}|[a-f0-9]{32})$/i.test(value)
}
