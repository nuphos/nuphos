import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import type { AgentTriggerGroup, TriggerGroupPartition } from '../trigger-group-db'
import type { WatchGroupProviderWiring } from '../trigger-provider-wiring'

export async function assertGroupIngressWiringConsistent(input: {
  receipt: WatchGroupProviderWiring
  partition: TriggerGroupPartition
  group: AgentTriggerGroup
  teamId: string
  triggerId: string
}): Promise<void> {
  const { receipt, partition, group } = input
  const bindings = await teamByosBindings().findOne(
    { _id: new ObjectId(input.teamId) },
    {
      projection: {
        grafanaInstances: 1,
        gcpServiceAccounts: 1,
        betterStackIntegrations: 1,
        awsRoles: 1,
      },
    },
  )
  const connected =
    partition.provider === 'grafana'
      ? (bindings?.grafanaInstances ?? []).some(
          (item) => item.id.toHexString() === partition.integrationId,
        )
      : partition.provider === 'gcp'
        ? (bindings?.gcpServiceAccounts ?? []).some(
            (item) =>
              item.id.toHexString() === partition.integrationId &&
              item.purpose !== 'permission-admin',
          )
        : partition.provider === 'betterstack'
          ? (bindings?.betterStackIntegrations ?? []).some(
              (item) =>
                item.id.toHexString() === partition.integrationId &&
                Boolean(item.encryptedUptimeApiToken),
            )
          : partition.provider === 'aws'
            ? (bindings?.awsRoles ?? []).some(
                (item) =>
                  item.id.toHexString() === partition.integrationId &&
                  item.purpose !== 'permission-admin',
              )
            : true

  if (!connected) {
    throw new AppError(
      409,
      'provider_integration_not_found',
      'The provider integration used by this Watch Group is no longer connected',
    )
  }
  if (
    receipt.wirings.some((wiring) => {
      if (
        wiring.provider === 'grafana' ||
        wiring.provider === 'betterstack' ||
        wiring.provider === 'aws'
      ) {
        return wiring.integrationId !== partition.integrationId
      }
      if (wiring.provider === 'gcp') {
        const binding = (bindings?.gcpServiceAccounts ?? []).find(
          (item) => item.id.toHexString() === partition.integrationId,
        )

        return (
          !binding ||
          binding.projectId !== wiring.projectId ||
          binding.serviceAccountEmail !== wiring.serviceAccountEmail
        )
      }

      return wiring.integrationId !== partition.integrationId
    })
  ) {
    throw new AppError(
      409,
      'group_wiring_integration_mismatch',
      'A shared ingress receipt must belong to its selected provider integration',
    )
  }
  const selectedResourceIds = new Set(
    group.members
      .filter((member) => partition.memberKeys.includes(member.key))
      .map((member) => member.resourceId),
  )
  const receiptResourceIds = new Set(
    receipt.wirings.flatMap((wiring) => {
      if (wiring.provider === 'grafana') return [wiring.alertRuleUid]
      if (wiring.provider === 'gcp') return [wiring.alertPolicyName]
      if (wiring.provider === 'aws') return [wiring.alarmArn]
      if (wiring.provider === 'generic') {
        return [wiring.resourceId, ...wiring.resources.map((resource) => resource.id)]
      }

      return wiring.monitorId ? [wiring.monitorId] : []
    }),
  )

  if (
    receipt.strategy !== 'global_subscription' &&
    [...selectedResourceIds].some((resourceId) => !receiptResourceIds.has(resourceId))
  ) {
    throw new AppError(
      400,
      'group_wiring_incomplete',
      'The shared provider receipt does not cover every selected monitoring item',
    )
  }
  if (
    receipt.wirings.some(
      (wiring) => wiring.provider !== 'generic' && wiring.provider !== partition.provider,
    )
  ) {
    throw new AppError(
      400,
      'group_wiring_provider_mismatch',
      'A Watch Group ingress may contain only its provider partition',
    )
  }
  if (
    partition.provider === 'aws' &&
    receipt.wirings.filter((wiring) => wiring.provider === 'aws').length > 1
  ) {
    throw new AppError(
      400,
      'group_wiring_strategy_unsupported',
      'Shared AWS topics spanning multiple alarms require a group-aware AWS receipt; use one composite alarm or a generic receipt for now',
    )
  }
  const grafanaWirings = receipt.wirings.filter((wiring) => wiring.provider === 'grafana')

  if (
    grafanaWirings.some((wiring) => wiring.labelValue !== input.triggerId) ||
    new Set(
      grafanaWirings.map(
        (wiring) =>
          `${wiring.contactPointUid}:${wiring.contactPointName}:${wiring.labelKey}:${wiring.labelValue}`,
      ),
    ).size > 1
  ) {
    throw new AppError(
      400,
      'group_wiring_transport_mismatch',
      'Grafana group members must share one contact point and one trigger-owned label route',
    )
  }
  const gcpWirings = receipt.wirings.filter((wiring) => wiring.provider === 'gcp')

  if (new Set(gcpWirings.map((wiring) => wiring.notificationChannelName)).size > 1) {
    throw new AppError(
      400,
      'group_wiring_transport_mismatch',
      'GCP group members must share one notification channel',
    )
  }
  const betterStackWirings = receipt.wirings.filter((wiring) => wiring.provider === 'betterstack')

  if (new Set(betterStackWirings.map((wiring) => wiring.outgoingWebhookId)).size > 1) {
    throw new AppError(
      400,
      'group_wiring_transport_mismatch',
      'Better Stack group members must share one outgoing webhook',
    )
  }
}
