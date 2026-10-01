import fs from 'node:fs/promises'

import yaml from 'js-yaml'

import { buildAtlasError } from '../atlas/error.ts'
import { CLI_CONFIG_PATH } from '../cli-config-path.ts'

export const ATLAS_URL =
  process.env.NUPHOS_API_URL || process.env.ATLAS_API_URL || 'https://api.nuphos.ai'

export function teamIdFromUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return /^\/teams\/([a-f0-9]{24})(?:\/|$)/.exec(new URL(url, 'https://nuphos.ai').pathname)?.[1]
  } catch {
    return undefined
  }
}

export async function readToken(): Promise<string | null> {
  try {
    const data = await fs.readFile(CLI_CONFIG_PATH, 'utf-8')
    const cfg = yaml.load(data) as { token?: string }

    return cfg?.token ?? null
  } catch {
    return null
  }
}

/**
 * The renderer can only see an error's message: IPC strips custom properties.
 * `electron/atlas/client.ts` solves that by encoding {code, details} into the
 * message under a sentinel, which `parseAtlasError` recovers — but AtlasHttpError
 * keeps them as properties, so an agent-route failure reached the renderer with
 * no code and was classified as an unexpected error. Re-encode it at the IPC
 * boundary so the backend's own message and code survive the crossing.
 */
export function agentIpcError(cause: unknown): unknown {
  if (!(cause instanceof AtlasHttpError)) return cause

  return buildAtlasError(cause.message, cause.code, cause.details)
}

/** `callJson` for a route whose failure the renderer has to explain to the user. */
export async function callJsonForRenderer<T>(
  method: string,
  route: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  try {
    return await callJson<T>(method, route, body, timeoutMs)
  } catch (cause) {
    throw agentIpcError(cause)
  }
}

export class AtlasHttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message)
    this.name = 'AtlasHttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function callJson<T>(
  method: string,
  route: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const token = await readToken()

  if (!token) throw new Error('Not signed in')
  const headers: Record<string, string> = { authorization: `Bearer ${token}` }
  const init: RequestInit = {
    method,
    headers,
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  }

  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${ATLAS_URL}${route}`, init)

  if (!res.ok) {
    let message = `HTTP ${String(res.status)}`
    let code: string | undefined
    let details: unknown

    try {
      const j = (await res.json()) as {
        error?: { message?: string; code?: string; details?: unknown }
      }

      if (j.error?.message) message = j.error.message
      if (j.error?.code) code = j.error.code
      if (j.error && 'details' in j.error) details = j.error.details
    } catch {
      // ignore
    }
    throw new AtlasHttpError(message, res.status, code, details)
  }
  if (res.status === 204) return undefined as T

  return (await res.json()) as T
}

export function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
}
