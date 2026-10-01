import { isDeepStrictEqual } from 'node:util'

import { ObjectId } from 'mongodb'
import { ZodError } from 'zod'

import { AppError } from '@/lib/errors'

import { legacyMonitoringWatchDedupeKey, monitoringWatchDedupeKey } from '../monitoring-workflow'
import { assertTriggerAccess } from '../trigger-access'
import { agentTriggers } from '../trigger-db'
import { parseMonitoringProviderWiring } from '../trigger-provider-wiring'

import {
  assertGrafanaReceiptRouting,
  assertProviderIntegrationConnected,
  assertProviderResourceScopes,
  monitoringIdentityForReceipt,
} from './finalize-wiring-checks'
import { parseTriggerId, serializeTrigger } from './shared'

import type { TriggerActor } from '../trigger-access'
import type { MonitoringProviderWiring } from '../trigger-provider-wiring'
import type { SerializedTrigger } from './shared'

/**
 * Persist the secret-free provider resource receipt only after the Agent has
 * completed native provider wiring, read-back, and the cheap drill. Creation
 * remains Agent-driven; future deletion never needs to invoke an Agent.
 */
export async function finalizeTriggerProviderWiring(
  triggerId: string,
  actor: TriggerActor,
  value: unknown,
): Promise<SerializedTrigger> {
  const _id = parseTriggerId(triggerId)
  let receipt: MonitoringProviderWiring

  try {
    receipt = parseMonitoringProviderWiring(value)
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError(
        400,
        'invalid_provider_wiring',
        'Provider wiring receipt is invalid',
        err.flatten(),
      )
    }
    throw err
  }
  const trigger = await agentTriggers().findOne({ _id })

  if (!trigger) throw new AppError(404, 'not_found', 'Trigger not found')
  await assertTriggerAccess(trigger, actor, 'manage')
  const teamId = trigger.teamId

  if (!teamId || !ObjectId.isValid(teamId)) {
    throw new AppError(
      400,
      'trigger_team_required',
      'Provider wiring can only be finalized for a team trigger',
    )
  }
  if (trigger.watchGroupId) {
    throw new AppError(
      400,
      'watch_group_wiring_required',
      'Watch Group ingresses must be finalized with a provider=watch_group receipt',
    )
  }
  if (trigger.triggerType !== 'webhook' || !trigger.webhookSecret) {
    throw new AppError(
      400,
      'invalid_trigger_type',
      'Provider wiring can only be finalized for webhook triggers',
    )
  }
  if (trigger.cleanupStatus) {
    throw new AppError(
      409,
      'trigger_cleanup_in_progress',
      'A Watch being removed cannot be finalized',
    )
  }
  const receiptIdentity = monitoringIdentityForReceipt(receipt)

  if (!receiptIdentity) {
    throw new AppError(
      400,
      'invalid_provider_wiring',
      'Better Stack Watch receipts must identify the exact monitor',
    )
  }
  const effectiveIdentity = trigger.monitoringIdentity ?? receiptIdentity
  const existingReceiptProvesIdentity =
    !trigger.monitoringIdentity &&
    Boolean(trigger.providerWiring) &&
    isDeepStrictEqual(trigger.providerWiring, receipt)
  // A pre-monitoringIdentity Watch is proven by its stored hash. Accept the
  // pre-team-ownership hash too, or team Watches wired before that change
  // could never be finalized.
  const legacyHashProvesIdentity =
    !trigger.monitoringIdentity &&
    Boolean(trigger.dedupeKey) &&
    [
      monitoringWatchDedupeKey(trigger.userId, trigger.teamId, receiptIdentity),
      legacyMonitoringWatchDedupeKey(trigger.userId, trigger.teamId, receiptIdentity),
    ].includes(trigger.dedupeKey!)

  if (
    (!trigger.monitoringIdentity && !legacyHashProvesIdentity && !existingReceiptProvesIdentity) ||
    !isDeepStrictEqual(effectiveIdentity, receiptIdentity)
  ) {
    throw new AppError(
      409,
      'provider_wiring_identity_mismatch',
      'The provider resource receipt does not match this Watch identity',
    )
  }
  assertGrafanaReceiptRouting(receipt, triggerId)
  await assertProviderIntegrationConnected(receipt, teamId)
  assertProviderResourceScopes(receipt, trigger.providerWiring)

  if (trigger.providerWiring) {
    if (!isDeepStrictEqual(trigger.providerWiring, receipt)) {
      throw new AppError(
        409,
        'provider_wiring_conflict',
        'This trigger is already finalized with a different provider resource receipt',
      )
    }
    if (!trigger.monitoringIdentity) {
      const backfilled = await agentTriggers().updateOne(
        {
          _id,
          cleanupStatus: { $exists: false },
          monitoringIdentity: { $exists: false },
        },
        { $set: { monitoringIdentity: effectiveIdentity } },
      )

      if (backfilled.matchedCount === 0) {
        throw new AppError(
          409,
          'trigger_changed',
          'Trigger changed concurrently; reload it and retry',
        )
      }
    }

    return serializeTrigger({ ...trigger, monitoringIdentity: effectiveIdentity })
  }

  const updatedAt = new Date()
  const result = await agentTriggers().updateOne(
    {
      _id,
      cleanupStatus: { $exists: false },
      providerWiring: { $exists: false },
      ...(trigger.monitoringIdentity
        ? {
            'monitoringIdentity.provider': trigger.monitoringIdentity.provider,
            'monitoringIdentity.integrationId': trigger.monitoringIdentity.integrationId,
            'monitoringIdentity.resourceId': trigger.monitoringIdentity.resourceId,
          }
        : { monitoringIdentity: { $exists: false } }),
    },
    {
      $set: {
        providerWiring: receipt,
        providerWiringFinalizedAt: updatedAt,
        monitoringIdentity: effectiveIdentity,
        updatedAt,
      },
    },
  )

  if (result.matchedCount === 0) {
    const current = await agentTriggers().findOne({ _id })

    if (current?.cleanupStatus) {
      throw new AppError(
        409,
        'trigger_cleanup_in_progress',
        'A Watch being removed cannot be finalized',
      )
    }
    if (current?.providerWiring && isDeepStrictEqual(current.providerWiring, receipt)) {
      return serializeTrigger(current)
    }
    throw new AppError(
      409,
      'provider_wiring_conflict',
      'Trigger provider wiring changed concurrently',
    )
  }

  return serializeTrigger({
    ...trigger,
    providerWiring: receipt,
    providerWiringFinalizedAt: updatedAt,
    monitoringIdentity: effectiveIdentity,
    updatedAt,
  })
}
