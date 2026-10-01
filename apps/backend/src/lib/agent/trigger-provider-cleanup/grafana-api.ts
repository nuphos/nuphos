import { AppError } from '@/lib/errors'

import { cleanupConflict } from './shared'

import type { GrafanaProviderWiring } from '../trigger-provider-wiring'
import type { JsonObject } from './shared'
import type { GrafanaInstanceBinding } from '@/models'

export async function grafanaRequest<T>(
  binding: GrafanaInstanceBinding,
  path: string,
  init: RequestInit = {},
  allowNotFound = false,
): Promise<T | null> {
  const headers = new Headers(init.headers)

  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${binding.saToken}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  let response: Response

  try {
    response = await fetch(`${binding.grafanaUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    throw new AppError(
      502,
      'provider_cleanup_unreachable',
      `Grafana cleanup could not reach ${binding.name}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (allowNotFound && response.status === 404) return null
  if (!response.ok) {
    throw new AppError(
      502,
      'provider_cleanup_failed',
      `Grafana cleanup failed at ${init.method ?? 'GET'} ${path} (HTTP ${String(response.status)})`,
    )
  }
  if (response.status === 204) return null
  const text = await response.text()

  return text ? (JSON.parse(text) as T) : null
}

export function hasExactMatcher(route: JsonObject, labelKey: string, labelValue: string): boolean {
  const matchers = Array.isArray(route.object_matchers) ? route.object_matchers : []

  return matchers.some(
    (matcher: unknown) =>
      Array.isArray(matcher) &&
      matcher.length >= 3 &&
      matcher[0] === labelKey &&
      matcher[1] === '=' &&
      matcher[2] === labelValue,
  )
}

export function findMatchingRoutes(
  policy: JsonObject,
  labelKey: string,
  labelValue: string,
): JsonObject[] {
  const matches: JsonObject[] = []
  const visit = (route: JsonObject) => {
    if (hasExactMatcher(route, labelKey, labelValue)) matches.push(route)
    for (const child of Array.isArray(route.routes) ? route.routes : []) visit(child)
  }

  visit(policy)

  return matches
}

export function removeManagedGrafanaRoute(
  policy: JsonObject,
  receipt: GrafanaProviderWiring,
): { policy: JsonObject; removed: number } {
  let removed = 0
  const visit = (route: JsonObject): JsonObject => {
    const next = structuredClone(route)
    const children = Array.isArray(route.routes) ? route.routes : []
    const kept: JsonObject[] = []

    for (const child of children) {
      const compatibilityReceiver =
        receipt.routingMode === 'direct_converted'
          ? receipt.previousNotificationSettings?.receiver
          : undefined

      if (
        (child.receiver === receipt.contactPointName ||
          (typeof compatibilityReceiver === 'string' &&
            child.receiver === compatibilityReceiver)) &&
        hasExactMatcher(child, receipt.labelKey, receipt.labelValue)
      ) {
        if (Array.isArray(child.routes) && child.routes.length > 0) {
          cleanupConflict(
            'The managed Grafana route now has child routes; refusing to remove external edits',
          )
        }
        removed += 1
      } else {
        kept.push(visit(child))
      }
    }
    if (children.length > 0 || 'routes' in route) next.routes = kept

    return next
  }

  return { policy: visit(policy), removed }
}

export function grafanaContactPointUrl(contactPoint: JsonObject): string | null {
  return typeof contactPoint.settings?.url === 'string' ? contactPoint.settings.url : null
}

export function findReceiverReferences(policy: JsonObject, receiver: string): number {
  let count = 0
  const visit = (route: JsonObject) => {
    if (route.receiver === receiver) count += 1
    for (const child of Array.isArray(route.routes) ? route.routes : []) visit(child)
  }

  visit(policy)

  return count
}
