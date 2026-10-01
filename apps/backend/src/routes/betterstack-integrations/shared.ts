import { z } from 'zod'

import { BetterStackApiError } from '@/lib/byos/betterstack'
import { decryptBetterStackToken, encryptBetterStackToken } from '@/lib/byos/secrets'
import { AppError } from '@/lib/errors'

import type { BetterStackIntegrationVariables } from '@/middleware/auth'
import type { BetterStackIntegrationBinding } from '@/models'

export const dashboardTeamIdSchema = z
  .string()
  .trim()
  .regex(/^t\d+$/, 'Expected a Better Stack team id like t74114')
export const prometheusWebhookUrlSchema = z
  .string()
  .trim()
  .regex(
    /^https:\/\/uptime\.betterstack\.com\/api\/v1\/prometheus\/webhook\/[A-Za-z0-9]+$/,
    'Expected a Better Stack Prometheus webhook URL (https://uptime.betterstack.com/api/v1/prometheus/webhook/…)',
  )

export const bindSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    uptimeApiToken: z.string().trim().min(1).optional(),
    telemetryApiToken: z.string().trim().min(1).optional(),
    dashboardTeamId: dashboardTeamIdSchema.optional(),
    prometheusWebhookUrl: prometheusWebhookUrlSchema.optional(),
  })
  .strict()
  .refine((value) => value.uptimeApiToken || value.telemetryApiToken, {
    message: 'Provide at least one Better Stack API token',
  })

const tokenPatchSchema = z.union([z.string().trim().min(1), z.null()])

export const updateSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    uptimeApiToken: tokenPatchSchema.optional(),
    telemetryApiToken: tokenPatchSchema.optional(),
    dashboardTeamId: z.union([dashboardTeamIdSchema, z.null()]).optional(),
    prometheusWebhookUrl: z.union([prometheusWebhookUrlSchema, z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one Better Stack integration setting to update',
  })

const monitorInputBaseSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    pronounceableName: z.string().trim().min(1).max(255).optional(),
    monitorType: z.string().trim().min(1).optional(),
    checkFrequency: z.number().int().positive().optional(),
    requestTimeout: z.number().int().positive().optional(),
    httpMethod: z.string().trim().toUpperCase().optional(),
    expectedStatusCodes: z.array(z.number().int().min(100).max(599)).optional(),
    requiredKeyword: z.string().optional(),
    verifySsl: z.boolean().optional(),
    teamName: z.string().trim().min(1).optional(),
  })
  .strict()

export const monitorInputSchema = monitorInputBaseSchema.refine(
  (value) => Object.keys(value).length > 0,
  {
    message: 'Provide at least one Better Stack monitor setting to update',
  },
)

export const createMonitorSchema = monitorInputBaseSchema.extend({
  url: z.string().trim().min(1),
  monitorType: z.string().trim().min(1),
})

export function publicView(binding: BetterStackIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    hasUptimeApiToken: Boolean(binding.encryptedUptimeApiToken),
    hasTelemetryApiToken: Boolean(binding.encryptedTelemetryApiToken),
    dashboardTeamId: binding.dashboardTeamId ?? null,
    // Whether a Prometheus webhook is configured — NOT the URL itself.
    // The URL is write-capable (anyone holding it can POST incidents), so
    // it is only returned by the allow-list-gated /credentials endpoint,
    // never by these team-member-visible list/get views.
    hasPrometheusWebhookUrl: Boolean(binding.prometheusWebhookUrl),
    createdAt: binding.createdAt,
  }
}

export function betterStackCredentials(c: {
  get: <K extends keyof BetterStackIntegrationVariables>(k: K) => BetterStackIntegrationVariables[K]
}) {
  return {
    uptimeApiToken: betterStackUptimeToken(c),
    telemetryApiToken: betterStackTelemetryToken(c),
  }
}

export function betterStackUptimeToken(c: {
  get: <K extends keyof BetterStackIntegrationVariables>(k: K) => BetterStackIntegrationVariables[K]
}) {
  const uptimeEnvelope = c.get('betterStackEncryptedUptimeApiToken')

  return uptimeEnvelope ? decryptBetterStackToken(uptimeEnvelope) : null
}

export function betterStackTelemetryToken(c: {
  get: <K extends keyof BetterStackIntegrationVariables>(k: K) => BetterStackIntegrationVariables[K]
}) {
  const telemetryEnvelope = c.get('betterStackEncryptedTelemetryApiToken')

  return telemetryEnvelope ? decryptBetterStackToken(telemetryEnvelope) : null
}

export function requireUptimeToken(token: string | null): string {
  if (!token) {
    throw new AppError(
      403,
      'betterstack_uptime_token_not_configured',
      'This Better Stack integration has no Uptime API token',
    )
  }

  return token
}

export function requireTelemetryToken(token: string | null): string {
  if (!token) {
    throw new AppError(
      403,
      'betterstack_telemetry_token_not_configured',
      'This Better Stack integration has no Telemetry API token',
    )
  }

  return token
}

export function betterStackError(err: unknown, fallback: string): AppError {
  if (err instanceof BetterStackApiError) {
    const code =
      err.status === 401 || err.status === 403
        ? 'invalid_betterstack_credentials'
        : 'betterstack_api_error'

    return new AppError(err.status === 401 || err.status === 403 ? 400 : 502, code, err.message)
  }

  return new AppError(502, 'betterstack_api_error', err instanceof Error ? err.message : fallback)
}

export function encryptBetterStackTokenOrUnavailable(token: string) {
  try {
    return encryptBetterStackToken(token)
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'Better Stack credential encryption key is unavailable',
    )
  }
}
