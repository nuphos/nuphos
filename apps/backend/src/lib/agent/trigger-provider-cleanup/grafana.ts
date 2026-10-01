import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import {
  findMatchingRoutes,
  findReceiverReferences,
  grafanaContactPointUrl,
  grafanaRequest,
  removeManagedGrafanaRoute,
} from './grafana-api'
import { cleanupConflict, sameJson, targetsManagedWebhook } from './shared'

import type { GrafanaProviderWiring } from '../trigger-provider-wiring'
import type { JsonObject } from './shared'
import type { ObjectId } from 'mongodb'

export async function cleanupGrafana(
  teamId: ObjectId,
  triggerId: string,
  receipt: GrafanaProviderWiring,
): Promise<void> {
  const doc = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { grafanaInstances: 1 } },
  )
  const binding = (doc?.grafanaInstances ?? []).find(
    (item) => item.id.toHexString() === receipt.integrationId,
  )

  if (!binding) cleanupConflict('The Grafana integration used by this Watch is no longer connected')

  const contactPoints =
    (await grafanaRequest<JsonObject[]>(binding, '/api/v1/provisioning/contact-points')) ?? []
  const contactPoint = contactPoints.find((item) => item.uid === receipt.contactPointUid)

  if (contactPoint) {
    const url = grafanaContactPointUrl(contactPoint)

    if (!targetsManagedWebhook(url, triggerId)) {
      cleanupConflict('The Grafana contact point no longer belongs to this Watch')
    }
    if (contactPoint.name !== receipt.contactPointName) {
      cleanupConflict(
        'The Grafana contact point was renamed; refusing to alter routing by a stale name',
      )
    }
  }

  const rulePath = `/api/v1/provisioning/alert-rules/${encodeURIComponent(receipt.alertRuleUid)}`
  const initialRule = await grafanaRequest<JsonObject>(binding, rulePath, {}, true)
  const policyPath = '/api/v1/provisioning/policies'
  const initialPolicy = await grafanaRequest<JsonObject>(binding, policyPath)

  if (!initialPolicy)
    throw new AppError(
      502,
      'provider_cleanup_failed',
      'Grafana returned an empty notification policy',
    )

  if (initialRule) {
    const labels =
      initialRule.labels && typeof initialRule.labels === 'object'
        ? (initialRule.labels as Record<string, unknown>)
        : {}
    const currentLabel = labels[receipt.labelKey]

    if (currentLabel !== undefined && currentLabel !== receipt.labelValue) {
      cleanupConflict('The Grafana alert rule Watch label now belongs to another workflow')
    }

    if (
      currentLabel === receipt.labelValue &&
      receipt.routingMode !== 'legacy_preserve_compatibility'
    ) {
      const nextRule = structuredClone(initialRule)

      delete nextRule.labels[receipt.labelKey]
      if (receipt.routingMode === 'direct_converted') {
        if (!receipt.previousNotificationSettings) {
          cleanupConflict(
            'The original direct Grafana notification settings are missing from the ownership receipt',
          )
        }
        if (initialRule.notification_settings != null) {
          cleanupConflict(
            'Grafana direct notification settings changed after this Watch was created',
          )
        }
        nextRule.notification_settings = receipt.previousNotificationSettings
      }
      const preflight = await grafanaRequest<JsonObject>(binding, rulePath, {}, true)

      if (!preflight || !sameJson(preflight, initialRule)) {
        cleanupConflict(
          'The Grafana alert rule changed while cleanup was preparing; retry after reviewing it',
        )
      }
      const versionedRulePath =
        initialRule.version !== undefined
          ? `${rulePath}?version=${encodeURIComponent(String(initialRule.version))}`
          : rulePath

      await grafanaRequest(binding, versionedRulePath, {
        method: 'PUT',
        body: JSON.stringify(nextRule),
      })
    }
  }

  const { policy: nextPolicy, removed } = removeManagedGrafanaRoute(initialPolicy, receipt)
  const expectedRouteCount = receipt.routingMode === 'direct_converted' ? 2 : 1

  if (removed > expectedRouteCount) {
    cleanupConflict(
      'More Grafana routes than expected claim this Watch; refusing an ambiguous cleanup',
    )
  }
  if (removed > 0) {
    const preflight = await grafanaRequest<JsonObject>(binding, policyPath)

    if (!preflight || !sameJson(preflight, initialPolicy)) {
      cleanupConflict(
        'The Grafana notification policy changed while cleanup was preparing; retry after reviewing it',
      )
    }
    await grafanaRequest(binding, policyPath, { method: 'PUT', body: JSON.stringify(nextPolicy) })
  }

  const policyAfter = await grafanaRequest<JsonObject>(binding, policyPath)
  const remainingManagedRoutes = policyAfter
    ? findMatchingRoutes(policyAfter, receipt.labelKey, receipt.labelValue).filter(
        (route) => route.receiver === receipt.contactPointName,
      )
    : []

  if (remainingManagedRoutes.length > 0) {
    throw new AppError(
      502,
      'provider_cleanup_verification_failed',
      'Grafana still selects the Nuphos contact point',
    )
  }
  if (receipt.routingMode === 'direct_converted') {
    const formerReceiver = receipt.previousNotificationSettings?.receiver
    const remainingCompatibilityRoutes =
      policyAfter && typeof formerReceiver === 'string'
        ? findMatchingRoutes(policyAfter, receipt.labelKey, receipt.labelValue).filter(
            (route) => route.receiver === formerReceiver,
          )
        : []

    if (remainingCompatibilityRoutes.length > 0) {
      throw new AppError(
        502,
        'provider_cleanup_verification_failed',
        'Grafana compatibility route still exists after deletion',
      )
    }
  }

  if (initialRule && receipt.routingMode !== 'legacy_preserve_compatibility') {
    const ruleAfter = await grafanaRequest<JsonObject>(binding, rulePath, {}, true)

    if (!ruleAfter) {
      throw new AppError(
        502,
        'provider_cleanup_verification_failed',
        'Grafana alert rule disappeared during cleanup',
      )
    }
    if (ruleAfter.labels?.[receipt.labelKey] === receipt.labelValue) {
      throw new AppError(
        502,
        'provider_cleanup_verification_failed',
        'Grafana alert rule still contains the Watch label',
      )
    }
    if (
      receipt.routingMode === 'direct_converted' &&
      !sameJson(ruleAfter.notification_settings, receipt.previousNotificationSettings)
    ) {
      throw new AppError(
        502,
        'provider_cleanup_verification_failed',
        'Grafana direct notification routing was not restored',
      )
    }
  }

  if (contactPoint) {
    const anyReceiverReference = policyAfter
      ? findReceiverReferences(policyAfter, receipt.contactPointName)
      : 0

    if (anyReceiverReference > 0) {
      cleanupConflict(
        'The Grafana contact point is now referenced by another route; it was detached but not deleted',
      )
    }
    await grafanaRequest(
      binding,
      `/api/v1/provisioning/contact-points/${encodeURIComponent(receipt.contactPointUid)}`,
      { method: 'DELETE' },
      true,
    )
  }
  const finalContactPoints =
    (await grafanaRequest<JsonObject[]>(binding, '/api/v1/provisioning/contact-points')) ?? []

  if (finalContactPoints.some((item) => item.uid === receipt.contactPointUid)) {
    throw new AppError(
      502,
      'provider_cleanup_verification_failed',
      'Grafana contact point still exists after deletion',
    )
  }
}
