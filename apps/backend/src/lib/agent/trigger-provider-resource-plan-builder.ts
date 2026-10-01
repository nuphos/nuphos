import { betterStackPlan, gcpPlan, grafanaPlan } from './trigger-provider-resource-plans-monitoring'

import type {
  ManagedProviderResource,
  ManagedProviderResourceContext,
  ManagedProviderResourcePlan,
} from './trigger-provider-resource-types'
import type {
  AwsProviderWiring,
  GenericProviderWiring,
  MonitoringProviderWiring,
  WatchGroupProviderWiring,
} from './trigger-provider-wiring'

function awsPlan(
  receipt: AwsProviderWiring,
  context: ManagedProviderResourceContext,
  recordedAt?: string,
): ManagedProviderResourcePlan {
  const region = encodeURIComponent(receipt.region)
  const alarmUrl =
    `https://${receipt.region}.console.aws.amazon.com/cloudwatch/home?region=${region}` +
    `#alarmsV2:alarm/${encodeURIComponent(receipt.alarmName)}`
  const topicUrl =
    `https://${receipt.region}.console.aws.amazon.com/sns/v3/home?region=${region}` +
    `#/topic/${encodeURIComponent(receipt.snsTopicArn)}`
  const subscriptionUrl =
    `https://${receipt.region}.console.aws.amazon.com/sns/v3/home?region=${region}` +
    `#/subscription/${encodeURIComponent(receipt.snsSubscriptionArn)}`
  const actionNames = receipt.attachedActions
    .map((action) => (action === 'alarm' ? 'ALARM' : 'OK'))
    .join(' and ')
  const topicWasCreated = receipt.snsTopicOrigin === 'created'

  return {
    provider: 'aws',
    integrationLabel: context.integrationLabel ?? `${receipt.accountId} · ${receipt.region}`,
    ...(recordedAt ? { recordedAt } : {}),
    resources: [
      {
        kind: 'cloudwatch_alarm',
        name: receipt.alarmName,
        id: receipt.alarmArn,
        url: alarmUrl,
        ownership: receipt.alarmOrigin === 'created' ? 'created' : 'modified',
        cleanupAction: 'preserve',
        description: `Nuphos attached its SNS topic to the ${actionNames} action; the alarm itself is preserved.`,
      },
      {
        kind: 'alarm_action_attachment',
        name: `${actionNames} action attachment`,
        id: `${receipt.alarmArn} -> ${receipt.snsTopicArn}`,
        url: alarmUrl,
        ownership: 'created',
        cleanupAction: 'detach',
        description: 'Routes this exact CloudWatch alarm state change to the Nuphos SNS topic.',
      },
      {
        kind: 'sns_topic',
        name: receipt.snsTopicArn.split(':').at(-1) ?? 'Nuphos SNS topic',
        id: receipt.snsTopicArn,
        url: topicUrl,
        ownership: topicWasCreated ? 'created' : 'referenced',
        cleanupAction: topicWasCreated ? 'delete' : 'preserve',
        description: topicWasCreated
          ? 'Dedicated SNS topic created for this Watch; deleted only if no unrelated subscriptions use it.'
          : 'Existing SNS topic referenced by this Watch; Nuphos never deletes it.',
      },
      {
        kind: 'sns_subscription',
        name: 'Nuphos HTTPS subscription',
        id: receipt.snsSubscriptionArn,
        url: subscriptionUrl,
        ownership: 'created',
        cleanupAction: 'delete',
        description: 'Signed SNS delivery from the topic to this Nuphos trigger.',
      },
    ],
    cleanupSteps: [
      {
        action: 'disable',
        description: 'Disable the Nuphos trigger before changing provider resources.',
      },
      {
        action: 'detach',
        description: `Remove only topic ${receipt.snsTopicArn} from the alarm's ${actionNames} actions.`,
        resourceId: receipt.alarmArn,
      },
      {
        action: 'delete',
        description: `Delete HTTPS subscription ${receipt.snsSubscriptionArn}.`,
        resourceId: receipt.snsSubscriptionArn,
      },
      ...(topicWasCreated
        ? [
            {
              action: 'delete' as const,
              description: `Delete topic ${receipt.snsTopicArn} if it has no unrelated subscriptions.`,
              resourceId: receipt.snsTopicArn,
            },
          ]
        : []),
      {
        action: 'preserve',
        description: 'Preserve the CloudWatch alarm and every pre-existing alarm action.',
        resourceId: receipt.alarmArn,
      },
    ],
  }
}

function genericPlan(
  receipt: GenericProviderWiring,
  recordedAt?: string,
): ManagedProviderResourcePlan {
  return {
    provider: receipt.providerKey,
    providerLabel: receipt.providerLabel,
    cleanupMode: 'manual',
    integrationLabel: receipt.integrationId,
    ...(recordedAt ? { recordedAt } : {}),
    resources: receipt.resources.map((resource) => ({
      ...resource,
      cleanupAction: 'manual' as const,
    })),
    cleanupSteps: [
      {
        action: 'disable',
        description: 'Disable the Nuphos trigger before changing provider resources.',
      },
      {
        action: 'manual',
        description: receipt.manualCleanupInstructions,
        resourceId: receipt.resourceId,
      },
      {
        action: 'preserve',
        description:
          'Nuphos preserves the dynamically wired provider resources because no provider-specific cleanup driver is installed.',
      },
    ],
  }
}

function watchGroupPlan(
  receipt: WatchGroupProviderWiring,
  context: ManagedProviderResourceContext,
  recordedAt?: string,
): ManagedProviderResourcePlan {
  const nestedPlans = receipt.wirings.map((wiring) =>
    buildManagedProviderResourcePlan(wiring, context, recordedAt),
  )
  const resources = new Map<string, ManagedProviderResource>()

  for (const plan of nestedPlans) {
    for (const resource of plan.resources) {
      resources.set(`${plan.provider}:${resource.kind}:${resource.id}`, resource)
    }
  }

  return {
    provider: receipt.providerKey,
    providerLabel: `${receipt.providerKey} Watch Group`,
    cleanupMode: nestedPlans.some((plan) => plan.cleanupMode === 'manual') ? 'manual' : 'automatic',
    integrationLabel: receipt.integrationId,
    ...(recordedAt ? { recordedAt } : {}),
    resources: [...resources.values()],
    cleanupSteps: [
      {
        action: 'disable',
        description: 'Disable the shared Nuphos ingress before changing provider resources.',
      },
      {
        action: 'detach',
        description: `Detach the shared ${receipt.strategy.replaceAll('_', ' ')} from all ${String(receipt.memberKeys.length)} selected members.`,
      },
      ...nestedPlans.flatMap((plan) =>
        plan.cleanupSteps.filter((step) => step.action !== 'disable'),
      ),
    ],
  }
}

export function buildManagedProviderResourcePlan(
  receipt: MonitoringProviderWiring,
  context: ManagedProviderResourceContext = {},
  recordedAt?: string,
): ManagedProviderResourcePlan {
  if (receipt.provider === 'grafana') {
    return grafanaPlan(receipt, context, recordedAt)
  }
  if (receipt.provider === 'gcp') return gcpPlan(receipt, context, recordedAt)
  if (receipt.provider === 'aws') return awsPlan(receipt, context, recordedAt)
  if (receipt.provider === 'generic') return genericPlan(receipt, recordedAt)
  if (receipt.provider === 'watch_group') return watchGroupPlan(receipt, context, recordedAt)

  return betterStackPlan(receipt, context, recordedAt)
}
