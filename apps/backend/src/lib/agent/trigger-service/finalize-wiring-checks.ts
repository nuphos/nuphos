import { ObjectId } from 'mongodb'

import { extractAwsAccountId } from '@/lib/byos/account'
import { AppError } from '@/lib/errors'
import { teamByosBindings } from '@/models'

import type { MonitoringIdentity } from '../monitoring-workflow'
import type { MonitoringProviderWiring } from '../trigger-provider-wiring'

export function monitoringIdentityForReceipt(
  receipt: MonitoringProviderWiring,
): MonitoringIdentity | null {
  if (receipt.provider === 'watch_group') return null
  if (receipt.provider === 'grafana') {
    return {
      provider: 'grafana',
      integrationId: receipt.integrationId,
      resourceId: receipt.alertRuleUid,
    }
  }
  if (receipt.provider === 'gcp') {
    return {
      provider: 'gcp',
      integrationId: `${receipt.projectId}:${receipt.serviceAccountEmail}`,
      resourceId: receipt.alertPolicyName,
    }
  }
  if (receipt.provider === 'aws') {
    return {
      provider: 'aws',
      integrationId: receipt.integrationId,
      resourceId: receipt.alarmArn,
    }
  }
  if (receipt.provider === 'generic') {
    return {
      provider: receipt.providerKey,
      integrationId: receipt.integrationId,
      resourceId: receipt.resourceId,
    }
  }

  return receipt.monitorId
    ? {
        provider: 'betterstack',
        integrationId: receipt.integrationId,
        resourceId: receipt.monitorId,
      }
    : null
}

export function assertGrafanaReceiptRouting(
  receipt: MonitoringProviderWiring,
  triggerId: string,
): void {
  if (receipt.provider !== 'grafana') return
  if (receipt.labelValue !== triggerId) {
    throw new AppError(
      400,
      'invalid_provider_wiring',
      'Grafana labelValue must equal this triggerId',
    )
  }
  if (receipt.routingMode === 'legacy_preserve_compatibility') {
    throw new AppError(
      400,
      'invalid_provider_wiring',
      'Legacy Grafana routing mode is reserved for backend discovery',
    )
  }
  if (receipt.routingMode === 'direct_converted' && !receipt.previousNotificationSettings) {
    throw new AppError(
      400,
      'invalid_provider_wiring',
      'Converted Grafana direct routing requires its previous notification settings',
    )
  }
  if (
    receipt.routingMode === 'direct_converted' &&
    typeof receipt.previousNotificationSettings?.receiver !== 'string'
  ) {
    throw new AppError(
      400,
      'invalid_provider_wiring',
      'Converted Grafana direct routing requires its previous receiver',
    )
  }
  if (receipt.routingMode === 'policy' && receipt.previousNotificationSettings) {
    throw new AppError(
      400,
      'invalid_provider_wiring',
      'Policy-routed Grafana receipts must not include direct notification settings',
    )
  }
}

export async function assertProviderIntegrationConnected(
  receipt: MonitoringProviderWiring,
  teamId: string,
): Promise<void> {
  const bindings = await teamByosBindings().findOne(
    { _id: new ObjectId(teamId) },
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
    receipt.provider === 'generic'
      ? // Generic providers may be exposed only through an authenticated CLI or
        // dynamically discovered API, so there is no universal BYOS collection
        // the backend can inspect. Identity matching above still binds the receipt
        // to the exact trigger/user/team; the Agent must read back and drill the
        // provider before this finalization call.
        true
      : receipt.provider === 'grafana'
        ? (bindings?.grafanaInstances ?? []).some(
            (item) => item.id.toHexString() === receipt.integrationId,
          )
        : receipt.provider === 'gcp'
          ? (bindings?.gcpServiceAccounts ?? []).some(
              (item) =>
                item.projectId === receipt.projectId &&
                item.serviceAccountEmail === receipt.serviceAccountEmail &&
                item.purpose !== 'permission-admin',
            )
          : receipt.provider === 'aws'
            ? (bindings?.awsRoles ?? []).some(
                (item) =>
                  item.id.toHexString() === receipt.integrationId &&
                  extractAwsAccountId(item.roleArn) === receipt.accountId &&
                  item.purpose !== 'permission-admin',
              )
            : (bindings?.betterStackIntegrations ?? []).some(
                (item) =>
                  item.id.toHexString() === receipt.integrationId &&
                  Boolean(item.encryptedUptimeApiToken),
              )

  if (!connected) {
    throw new AppError(
      409,
      'provider_integration_not_found',
      'The provider integration in this receipt is not connected to the trigger team',
    )
  }
}

export function assertProviderResourceScopes(
  receipt: MonitoringProviderWiring,
  existingWiring: MonitoringProviderWiring | undefined,
): void {
  if (receipt.provider === 'gcp') {
    const prefix = `projects/${receipt.projectId}/`

    if (
      !receipt.alertPolicyName.startsWith(`${prefix}alertPolicies/`) ||
      !receipt.notificationChannelName.startsWith(`${prefix}notificationChannels/`)
    ) {
      throw new AppError(
        400,
        'invalid_provider_wiring',
        'GCP resources must belong to the receipt project',
      )
    }
    if (!receipt.alertPolicyOrigin && !existingWiring) {
      throw new AppError(
        400,
        'invalid_provider_wiring',
        'New GCP Watch receipts must say whether the alert policy already existed or was created by Nuphos',
      )
    }
  }
  if (receipt.provider === 'aws') {
    const alarmArnParts = receipt.alarmArn.split(':')
    const topicArnParts = receipt.snsTopicArn.split(':')

    if (
      alarmArnParts[3] !== receipt.region ||
      alarmArnParts[4] !== receipt.accountId ||
      receipt.alarmArn.slice(alarmArnParts.slice(0, 5).join(':').length + 1) !==
        `alarm:${receipt.alarmName}` ||
      topicArnParts[3] !== receipt.region ||
      topicArnParts[4] !== receipt.accountId ||
      !receipt.snsSubscriptionArn.startsWith(`${receipt.snsTopicArn}:`)
    ) {
      throw new AppError(
        400,
        'invalid_provider_wiring',
        'AWS alarm, topic, and subscription resources must belong to the receipt account and region',
      )
    }
  }
}
