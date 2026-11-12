import { buildAtlasError } from '../atlas/error.ts'

// How the backend explains a failed request.

/** The backend's error as an atlas error, so the renderer keeps its code and details. */
export async function apiError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: unknown; code?: unknown; details?: unknown }
  } | null
  const error = body?.error
  const message = typeof error?.message === 'string' ? error.message : `HTTP ${String(res.status)}`

  return typeof error?.code === 'string'
    ? buildAtlasError(message, error.code, error.details)
    : new Error(message)
}

export async function apiErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null

  return typeof body?.error?.message === 'string'
    ? body.error.message
    : `HTTP ${String(res.status)}`
}
