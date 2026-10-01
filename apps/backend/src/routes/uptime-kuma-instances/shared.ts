import { z } from 'zod'

import { canUseAllowList } from '@/lib/byos/access'
import { decryptUptimeKumaSecret, encryptUptimeKumaSecret } from '@/lib/byos/secrets'
import {
  UptimeKumaApiError,
  blockedUptimeKumaHostReason,
  normalizeUptimeKumaBaseUrl,
} from '@/lib/byos/uptime-kuma'
import { AppError } from '@/lib/errors'

import type { UptimeKumaAuthHandle } from '@/lib/byos/uptime-kuma'
import type { UptimeKumaInstanceBinding } from '@/models'

export const baseUrlSchema = z
  .string()
  .trim()
  .url()
  .transform(normalizeUptimeKumaBaseUrl)
  .superRefine((value, ctx) => {
    const reason = blockedUptimeKumaHostReason(value)

    if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason })
  })

export function publicView(binding: UptimeKumaInstanceBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    baseUrl: binding.baseUrl,
    username: binding.username ?? null,
    authType: binding.encryptedAuthToken ? 'token' : 'password',
    createdAt: binding.createdAt,
  }
}

// Shared by the list GET and the aggregated /connectors endpoint — unlike most
// connector lists, Uptime Kuma applies the member allow-list.
export function uptimeKumaInstancesView(
  bindings: UptimeKumaInstanceBinding[] | undefined,
  userId: string,
) {
  return (bindings ?? [])
    .filter((binding) => canUseAllowList(binding.access?.memberAllowList, userId))
    .map(publicView)
}

export function uptimeKumaError(err: unknown, fallback: string): AppError {
  if (err instanceof UptimeKumaApiError) {
    const code =
      err.status === 401 || err.status === 403
        ? 'invalid_uptime_kuma_credentials'
        : 'uptime_kuma_api_error'

    return new AppError(err.status === 401 || err.status === 403 ? 400 : 502, code, err.message)
  }

  return new AppError(502, 'uptime_kuma_api_error', err instanceof Error ? err.message : fallback)
}

export function encryptUptimeKumaSecretOrUnavailable(secret: string) {
  try {
    return encryptUptimeKumaSecret(secret)
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'Uptime Kuma credential encryption key is unavailable',
    )
  }
}

export function handleFromBinding(binding: UptimeKumaInstanceBinding): UptimeKumaAuthHandle {
  return {
    baseUrl: binding.baseUrl,
    ...(binding.encryptedAuthToken
      ? { authToken: decryptUptimeKumaSecret(binding.encryptedAuthToken) }
      : {}),
    ...(binding.username ? { username: binding.username } : {}),
    ...(binding.encryptedPassword
      ? { password: decryptUptimeKumaSecret(binding.encryptedPassword) }
      : {}),
  }
}

export function monitorIdParam(raw: string): number {
  const id = Number(raw)

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(400, 'invalid_monitor_id', 'monitorId must be a positive integer')
  }

  return id
}
