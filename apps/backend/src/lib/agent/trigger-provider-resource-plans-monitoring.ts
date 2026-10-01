import { stripTrailingSlashes } from '@/lib/agent/text-scan'

import type {
  ManagedProviderResourceContext,
  ManagedProviderResourcePlan,
} from './trigger-provider-resource-types'
import type {
  BetterStackProviderWiring,
  GcpProviderWiring,
  GrafanaProviderWiring,
} from './trigger-provider-wiring'

function trimBaseUrl(value: string | undefined): string | undefined {
  return value === undefined ? undefined : stripTrailingSlashes(value)
}

/**
 * Grafana's receiver details route uses the Notifications API receiver
 * metadata ID, which is base64url(contact point name). This is distinct from
 * the provisioning API UID persisted in the ownership receipt.
 */
function grafanaReceiverUrlId(contactPointName: string): string {
  return Buffer.from(contactPointName, 'utf8').toString('base64url')
}

export function grafanaPlan(
  receipt: GrafanaProviderWiring,
  context: ManagedProviderResourceContext,
  recordedAt?: string,
): ManagedProviderResourcePlan {
  const base = trimBaseUrl(context.grafanaUrl)
  const ruleUrl = base
    ? `${base}/alerting/grafana/${encodeURIComponent(receipt.alertRuleUid)}/view`
    : undefined
  const routingUrl = base ? `${base}/alerting/routes` : undefined
  const contactPointUrl = base
    ? `${base}/alerting/notifications/receivers/${grafanaReceiverUrlId(receipt.contactPointName)}/edit`
    : undefined
  const routeId = `${receipt.labelKey}=${receipt.labelValue}`
  const restoresDirectSettings = receipt.routingMode === 'direct_converted'

  return {
    provider: 'grafana',
    ...(context.integrationLabel ? { integrationLabel: context.integrationLabel } : {}),
    ...(recordedAt ? { recordedAt } : {}),
    resources: [
      {
        kind: 'alert_rule',
        name: 'Grafana alert rule',
        id: receipt.alertRuleUid,
        ...(ruleUrl ? { url: ruleUrl } : {}),
        ownership: 'modified',
        cleanupAction: restoresDirectSettings ? 'restore' : 'detach',
        description: restoresDirectSettings
          ? 'Nuphos added a Watch label and converted direct notification routing.'
          : 'Nuphos added a Watch label; the alert rule itself is preserved.',
      },
      {
        kind: 'notification_policy_route',
        name: 'Notification policy route',
        id: routeId,
        ...(routingUrl ? { url: routingUrl } : {}),
        ownership: 'created',
        cleanupAction: 'detach',
        description: `Routes only alerts carrying ${routeId} to the Nuphos contact point.`,
      },
      {
        kind: 'contact_point',
        name: receipt.contactPointName,
        id: receipt.contactPointUid,
        ...(contactPointUrl ? { url: contactPointUrl } : {}),
        ownership: 'created',
        cleanupAction: 'delete',
        description: 'Nuphos webhook contact point for this Watch.',
      },
    ],
    cleanupSteps: [
      {
        action: 'disable',
        description: 'Disable the Nuphos trigger before changing provider resources.',
      },
      ...(restoresDirectSettings
        ? [
            {
              action: 'restore' as const,
              description: `Restore the previous direct notification settings on alert rule ${receipt.alertRuleUid}.`,
              resourceId: receipt.alertRuleUid,
            },
          ]
        : [
            {
              action: 'detach' as const,
              description: `Remove label ${routeId} from alert rule ${receipt.alertRuleUid}.`,
              resourceId: receipt.alertRuleUid,
            },
          ]),
      {
        action: 'detach',
        description: `Remove the exact notification route matching ${routeId}.`,
        resourceId: routeId,
      },
      {
        action: 'delete',
        description: `Delete contact point ${receipt.contactPointName} (${receipt.contactPointUid}) after it has no references.`,
        resourceId: receipt.contactPointUid,
      },
      {
        action: 'preserve',
        description: 'Preserve the Grafana alert rule and every existing notification destination.',
        resourceId: receipt.alertRuleUid,
      },
    ],
  }
}

function gcpResourceId(name: string): string {
  return name.split('/').pop() ?? name
}

export function gcpPlan(
  receipt: GcpProviderWiring,
  context: ManagedProviderResourceContext,
  recordedAt?: string,
): ManagedProviderResourcePlan {
  const policyId = gcpResourceId(receipt.alertPolicyName)
  const project = encodeURIComponent(receipt.projectId)
  const policyUrl = `https://console.cloud.google.com/monitoring/alerting/policies/${encodeURIComponent(policyId)}?project=${project}`
  const channelsUrl = `https://console.cloud.google.com/monitoring/alerting/notifications?project=${project}`
  const attachmentId = `${receipt.alertPolicyName} -> ${receipt.notificationChannelName}`
  const policyWasCreated = receipt.alertPolicyOrigin === 'created'
  const policyDescription = policyWasCreated
    ? 'Nuphos created this alert policy; current removal preserves the policy after detaching delivery.'
    : receipt.alertPolicyOrigin === 'existing'
      ? 'Nuphos attached its notification channel; the existing policy is preserved.'
      : 'This legacy Watch did not record who created the alert policy; removal preserves it after detaching delivery.'

  return {
    provider: 'gcp',
    integrationLabel: context.integrationLabel ?? receipt.projectId,
    ...(recordedAt ? { recordedAt } : {}),
    resources: [
      {
        kind: 'alert_policy',
        name: 'Cloud Monitoring alert policy',
        id: receipt.alertPolicyName,
        url: policyUrl,
        ownership: policyWasCreated ? 'created' : 'modified',
        cleanupAction: 'preserve',
        description: policyDescription,
      },
      {
        kind: 'notification_channel_attachment',
        name: 'Notification channel attachment',
        id: attachmentId,
        url: policyUrl,
        ownership: 'created',
        cleanupAction: 'detach',
        description: 'Connects this exact alert policy to the Nuphos webhook channel.',
      },
      {
        kind: 'notification_channel',
        name: 'Nuphos notification channel',
        id: receipt.notificationChannelName,
        url: channelsUrl,
        ownership: 'created',
        cleanupAction: 'delete',
        description: 'Cloud Monitoring webhook channel created for this Watch.',
      },
    ],
    cleanupSteps: [
      {
        action: 'disable',
        description: 'Disable the Nuphos trigger before changing provider resources.',
      },
      {
        action: 'detach',
        description: `Detach notification channel ${receipt.notificationChannelName} from alert policy ${receipt.alertPolicyName}.`,
        resourceId: attachmentId,
      },
      {
        action: 'delete',
        description: `Delete notification channel ${receipt.notificationChannelName} after no policies reference it.`,
        resourceId: receipt.notificationChannelName,
      },
      {
        action: 'preserve',
        description: 'Preserve the alert policy and every pre-existing notification channel.',
        resourceId: receipt.alertPolicyName,
      },
    ],
  }
}

export function betterStackPlan(
  receipt: BetterStackProviderWiring,
  context: ManagedProviderResourceContext,
  recordedAt?: string,
): ManagedProviderResourcePlan {
  const dashboardRoot = 'https://uptime.betterstack.com'
  const monitorUrl =
    receipt.monitorId && context.betterStackDashboardTeamId
      ? `${dashboardRoot}/team/${encodeURIComponent(context.betterStackDashboardTeamId)}/monitors/${encodeURIComponent(receipt.monitorId)}`
      : dashboardRoot
  const outgoingWebhookUrl = context.betterStackDashboardTeamId
    ? `${dashboardRoot}/team/${encodeURIComponent(context.betterStackDashboardTeamId)}/integrations/webhooks/${encodeURIComponent(receipt.outgoingWebhookId)}/edit`
    : dashboardRoot

  return {
    provider: 'betterstack',
    ...(context.integrationLabel ? { integrationLabel: context.integrationLabel } : {}),
    ...(recordedAt ? { recordedAt } : {}),
    resources: [
      ...(receipt.monitorId
        ? [
            {
              kind: 'monitor',
              name: 'Better Stack monitor',
              id: receipt.monitorId,
              url: monitorUrl,
              ownership: 'referenced' as const,
              cleanupAction: 'preserve' as const,
              description: 'Existing monitor watched by this workflow; Nuphos never deletes it.',
            },
          ]
        : []),
      {
        kind: 'outgoing_webhook',
        name: 'Nuphos outgoing webhook',
        id: receipt.outgoingWebhookId,
        url: outgoingWebhookUrl,
        ownership: 'created',
        cleanupAction: 'delete',
        description: `Outgoing webhook created for the ${receipt.scope} scope.`,
      },
    ],
    cleanupSteps: [
      {
        action: 'disable',
        description: 'Disable the Nuphos trigger before changing provider resources.',
      },
      {
        action: 'delete',
        description: `Delete outgoing webhook ${receipt.outgoingWebhookId}.`,
        resourceId: receipt.outgoingWebhookId,
      },
      {
        action: 'preserve',
        description: receipt.monitorId
          ? `Preserve monitor ${receipt.monitorId} and every unrelated outgoing webhook.`
          : 'Preserve every Better Stack monitor and unrelated outgoing webhook.',
        ...(receipt.monitorId ? { resourceId: receipt.monitorId } : {}),
      },
    ],
  }
}
