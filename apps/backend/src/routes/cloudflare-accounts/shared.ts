import { z } from 'zod'

import { cloudflareAccountHandle } from '@/lib/byos/cloudflare-account-handle'
import { decryptCloudflareApiKey } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'

import type { CloudflareAccountHandle } from '@/lib/byos/cloudflare'
import type { R2S3Handle } from '@/lib/byos/cloudflare-r2'
import type { CloudflareAccountVariables } from '@/middleware/auth'

export const cloudflareIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{32}$/i)
  .transform((v) => v.toLowerCase())

export function parseCloudflareIdParam(value: string, label: string): string {
  const parsed = cloudflareIdSchema.safeParse(value)

  if (!parsed.success) {
    throw new AppError(400, 'invalid_request', `${label} must be a 32-character Cloudflare ID`)
  }

  return parsed.data
}

const d1IdSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)
  .transform((v) => v.toLowerCase())

export function parseD1IdParam(value: string): string {
  const parsed = d1IdSchema.safeParse(value)

  if (!parsed.success) {
    throw new AppError(400, 'invalid_request', 'databaseId must be a UUID')
  }

  return parsed.data
}

/**
 * Validate a path segment that is an arbitrary Cloudflare resource name
 * (R2 bucket, Pages project, Worker script, hostname). Hono URL-decodes params,
 * so we reject control chars / slashes / empty values to keep paths safe.
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)

    if (code <= 0x1f || code === 0x7f) return true
  }

  return false
}

export function parseNameParam(value: string, label: string): string {
  const v = (value ?? '').trim()

  // Hyphens and dots are valid (bucket names, hostnames, scripts); reject
  // whitespace/control chars, path separators and traversal.
  if (!v || v.length > 256 || v === '..' || /[\s/\\]/.test(v) || hasControlChar(v)) {
    throw new AppError(400, 'invalid_request', `${label} is invalid`)
  }

  return v
}

export function requireQueryKey(c: { req: { query: (k: string) => string | undefined } }): string {
  const key = c.req.query('key')

  if (!key || key.length > 1024) {
    throw new AppError(400, 'invalid_request', 'key query parameter is required')
  }

  return key
}

export async function accountHandleFor(c: {
  get: <K extends keyof CloudflareAccountVariables>(k: K) => CloudflareAccountVariables[K]
}): Promise<CloudflareAccountHandle> {
  const binding = c.get('cloudflareBinding')

  return cloudflareAccountHandle(parseObjectId(c.get('teamId'), 'teamId'), binding)
}

export function r2S3HandleFor(c: {
  get: <K extends keyof CloudflareAccountVariables>(k: K) => CloudflareAccountVariables[K]
}): R2S3Handle {
  const creds = c.get('cloudflareR2S3')

  if (!creds) {
    throw new AppError(
      400,
      'r2_credentials_not_bound',
      'Bind R2 S3 API credentials (Access Key ID + Secret) to browse objects in this account.',
    )
  }

  return {
    accountId: c.get('cloudflareAccountId'),
    accessKeyId: creds.accessKeyId,
    secretAccessKey: decryptCloudflareApiKey(creds.encryptedSecretAccessKey),
  }
}
