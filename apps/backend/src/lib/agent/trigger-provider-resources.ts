import { ObjectId } from 'mongodb'

import { teamByosBindings } from '@/models'

import { buildManagedProviderResourcePlan } from './trigger-provider-resource-plan-builder'

import type { AgentTrigger } from './trigger-db'
import type {
  ManagedProviderResourceContext,
  ManagedProviderResourcePlan,
} from './trigger-provider-resource-types'

export type {
  ManagedProviderCleanupAction,
  ManagedProviderCleanupStep,
  ManagedProviderCleanupStepAction,
  ManagedProviderResource,
  ManagedProviderResourceContext,
  ManagedProviderResourceOwnership,
  ManagedProviderResourcePlan,
} from './trigger-provider-resource-types'
export { buildManagedProviderResourcePlan } from './trigger-provider-resource-plan-builder'

/**
 * Build the user-facing projection from the persisted ownership receipt. This
 * intentionally does not call the provider API: the cleanup worker revalidates
 * live state immediately before mutation, while this view explains what Nuphos
 * recorded and will attempt to remove.
 */
export async function managedProviderResourcePlanForTrigger(
  trigger: AgentTrigger,
): Promise<ManagedProviderResourcePlan | undefined> {
  if (
    !trigger._id ||
    !trigger.providerWiring ||
    !trigger.teamId ||
    !ObjectId.isValid(trigger.teamId)
  ) {
    return undefined
  }

  const receipt = trigger.providerWiring
  const teamId = new ObjectId(trigger.teamId)
  const context: ManagedProviderResourceContext = {}
  const bindings = await teamByosBindings().findOne(
    { _id: teamId },
    { projection: { grafanaInstances: 1, betterStackIntegrations: 1, awsRoles: 1 } },
  )

  if (receipt.provider === 'watch_group') {
    if (receipt.providerKey === 'grafana') {
      const binding = (bindings?.grafanaInstances ?? []).find(
        (item) => item.id.toHexString() === receipt.integrationId,
      )

      if (binding) {
        context.integrationLabel = binding.name
        context.grafanaUrl = binding.grafanaUrl
      }
    } else if (receipt.providerKey === 'betterstack') {
      const binding = (bindings?.betterStackIntegrations ?? []).find(
        (item) => item.id.toHexString() === receipt.integrationId,
      )

      if (binding) {
        context.integrationLabel = binding.label
        context.betterStackDashboardTeamId = binding.dashboardTeamId
      }
    } else if (receipt.providerKey === 'aws') {
      const binding = (bindings?.awsRoles ?? []).find(
        (item) => item.id.toHexString() === receipt.integrationId,
      )
      const awsReceipt = receipt.wirings.find((wiring) => wiring.provider === 'aws')

      if (awsReceipt) {
        context.integrationLabel = binding
          ? `${awsReceipt.accountId} · ${binding.roleArn.split('/').at(-1) ?? awsReceipt.region}`
          : `${awsReceipt.accountId} · ${awsReceipt.region}`
      }
    } else {
      context.integrationLabel = receipt.integrationId
    }
  } else if (receipt.provider === 'grafana') {
    const binding = (bindings?.grafanaInstances ?? []).find(
      (item) => item.id.toHexString() === receipt.integrationId,
    )

    if (binding) {
      context.integrationLabel = binding.name
      context.grafanaUrl = binding.grafanaUrl
    }
  } else if (receipt.provider === 'gcp') {
    context.integrationLabel = receipt.projectId
  } else if (receipt.provider === 'aws') {
    const binding = (bindings?.awsRoles ?? []).find(
      (item) => item.id.toHexString() === receipt.integrationId,
    )

    context.integrationLabel = binding
      ? `${receipt.accountId} · ${binding.roleArn.split('/').at(-1) ?? receipt.region}`
      : `${receipt.accountId} · ${receipt.region}`
  } else if (receipt.provider === 'betterstack') {
    const binding = (bindings?.betterStackIntegrations ?? []).find(
      (item) => item.id.toHexString() === receipt.integrationId,
    )

    if (binding) {
      context.integrationLabel = binding.label
      context.betterStackDashboardTeamId = binding.dashboardTeamId
    }
  }

  return buildManagedProviderResourcePlan(
    receipt,
    context,
    trigger.providerWiringFinalizedAt?.toISOString(),
  )
}
