import { stripTrailingSlashes } from '@/lib/agent/text-scan'
import { AppError } from '@/lib/errors'

export type JsonObject = Record<string, any>

function managedWebhookMarker(triggerId: string): string {
  return `/webhooks/${triggerId}`
}

/** Provider resources are owned only when their URL targets this exact path. */
export function targetsManagedWebhook(value: unknown, triggerId: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.username || url.password) return false

    return stripTrailingSlashes(url.pathname) === managedWebhookMarker(triggerId)
  } catch {
    return false
  }
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

export function sameJson(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

export function cleanupConflict(message: string): never {
  throw new AppError(409, 'provider_cleanup_conflict', message)
}
