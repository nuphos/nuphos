import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'

import { errorTelemetryProperties, logError } from '@/lib/observability'
import { captureException } from '@/lib/posthog'

import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

// Distinct from the `not_found` handlers raise for missing records: this one
// means the client asked for a route that doesn't exist (version skew), and its
// message is a routing diagnostic. Clients key on the code to keep it off
// screen — see decideErrorToast in apps/desktop/src/api.ts.
export const notFoundHandler: NotFoundHandler = (c: Context) => {
  rememberErrorCode(c, 'route_not_found')

  return c.json(
    {
      error: {
        code: 'route_not_found',
        message: `Route ${c.req.method} ${c.req.path} not found`,
        requestId: c.get('requestId'),
      },
    },
    404,
  )
}

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    captureHttpError(err, c, err.status, err.code)

    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          requestId: c.get('requestId'),
        },
      },
      err.status,
    )
  }
  if (err instanceof HTTPException) {
    captureHttpError(err, c, err.status, 'http_exception')

    return c.json(
      { error: { code: 'http_exception', message: err.message, requestId: c.get('requestId') } },
      err.status,
    )
  }
  if (err instanceof ZodError) {
    rememberErrorCode(c, 'validation_error')

    return c.json(
      {
        error: {
          code: 'validation_error',
          message: 'Invalid input',
          details: err.flatten(),
          requestId: c.get('requestId'),
        },
      },
      400,
    )
  }
  const cloudStatus = detectCloudErrorStatus(err)

  if (cloudStatus !== null && cloudStatus >= 400 && cloudStatus < 500) {
    rememberErrorCode(c, 'cloud_api_error')
    logError('http.cloud_api_error', err, {
      context: c,
      status: 502,
      error_code: 'cloud_api_error',
      upstream_status: cloudStatus,
    })

    return c.json(
      {
        error: {
          code: 'cloud_api_error',
          message: err instanceof Error ? err.message : String(err),
          upstreamStatus: cloudStatus,
          requestId: c.get('requestId'),
        },
      },
      502,
    )
  }

  captureHttpError(err, c, 500, 'internal_error')

  return c.json(
    {
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        requestId: c.get('requestId'),
      },
    },
    500,
  )
}

const ERROR_CODE_KEY = 'errorCode'

function rememberErrorCode(c: Context, code: string): void {
  c.set(ERROR_CODE_KEY, code)
}

/** The error code this request answered with, for the access log. */
export function responseErrorCode(c: Context): string | undefined {
  const code: unknown = c.get(ERROR_CODE_KEY)

  return typeof code === 'string' ? code : undefined
}

function captureHttpError(err: unknown, c: Context, status: number, code: string): void {
  rememberErrorCode(c, code)
  if (status < 500) return
  const userId = c.get('userId')

  logError('http.request.error', err, {
    context: c,
    status,
    error_code: code,
  })
  captureException(err, {
    source: 'http.request',
    distinctId: typeof userId === 'string' ? userId : undefined,
    context: c,
    properties: {
      ...errorTelemetryProperties(err),
      status,
      error_code: code,
    },
  })
}

function detectCloudErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const e = err as {
    code?: number | string
    status?: number
    $metadata?: { httpStatusCode?: number }
    response?: { status?: number }
  }

  if (typeof e.$metadata?.httpStatusCode === 'number') return e.$metadata.httpStatusCode
  if (typeof e.response?.status === 'number') return e.response.status
  if (typeof e.status === 'number') return e.status
  if (typeof e.code === 'number') return e.code

  return null
}
