import { z } from 'zod'

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i)
const providerId = z.string().min(1).max(512)
const grafanaInterval = z.string().min(1).max(128)
const grafanaIntervalNames = z.array(z.string().min(1).max(190)).max(100)

/** Exact reversible fields from Grafana's alert-rule notification_settings. */
const grafanaNotificationSettingsSchema = z
  .object({
    receiver: z.string().min(1).max(190),
    group_by: z.array(z.string().min(1).max(190)).max(100).optional(),
    group_wait: grafanaInterval.optional(),
    group_interval: grafanaInterval.optional(),
    repeat_interval: grafanaInterval.optional(),
    mute_time_intervals: grafanaIntervalNames.optional(),
    active_time_intervals: grafanaIntervalNames.optional(),
  })
  .strict()

const grafanaProviderWiringSchema = z
  .object({
    provider: z.literal('grafana'),
    integrationId: objectIdString,
    alertRuleUid: providerId,
    contactPointUid: providerId,
    contactPointName: z.string().min(1).max(190),
    labelKey: z
      .string()
      .regex(/^[A-Za-z_]\w*$/)
      .max(128),
    labelValue: providerId,
    routingMode: z.enum(['policy', 'direct_converted', 'legacy_preserve_compatibility']),
    /** Only the former direct receiver/timing object; never contains a credential. */
    previousNotificationSettings: grafanaNotificationSettingsSchema.optional(),
  })
  .strict()

const gcpProviderWiringSchema = z
  .object({
    provider: z.literal('gcp'),
    projectId: z.string().min(1).max(256),
    serviceAccountEmail: z.string().email().max(320),
    alertPolicyName: z.string().min(1).max(512),
    /** Whether the policy predated the Watch. Optional only for legacy receipts. */
    alertPolicyOrigin: z.enum(['existing', 'created']).optional(),
    notificationChannelName: z.string().min(1).max(512),
  })
  .strict()

const betterStackProviderWiringSchema = z
  .object({
    provider: z.literal('betterstack'),
    integrationId: objectIdString,
    outgoingWebhookId: providerId,
    monitorId: providerId.optional(),
    scope: z.enum(['monitor', 'account']),
  })
  .strict()

// The connected AWS role path currently supports the commercial partition
// only. Accepting GovCloud/China receipts here would make cleanup impossible
// because the account matcher and role assumption path do not support them.
const awsRegion = z
  .string()
  .regex(/^(?!cn-|us-gov-)[a-z]{2}-[a-z]+-\d$/)
  .max(32)
const awsAccountId = z.string().regex(/^\d{12}$/)
const awsAlarmArn = z
  .string()
  .regex(/^arn:aws:cloudwatch:[^:]+:\d{12}:alarm:.+$/)
  .max(2048)
const awsTopicArn = z
  .string()
  .regex(/^arn:aws:sns:[^:]+:\d{12}:[^:]+$/)
  .max(2048)
const awsSubscriptionArn = z
  .string()
  .regex(/^arn:aws:sns:[^:]+:\d{12}:[^:]+:[^:]+$/)
  .max(2048)

const awsProviderWiringSchema = z
  .object({
    provider: z.literal('aws'),
    /** ObjectId of the connected operational AWS role binding. */
    integrationId: objectIdString,
    accountId: awsAccountId,
    region: awsRegion,
    alarmName: z.string().min(1).max(255),
    alarmArn: awsAlarmArn,
    alarmKind: z.enum(['metric', 'composite']),
    alarmOrigin: z.enum(['existing', 'created']),
    snsTopicArn: awsTopicArn,
    snsTopicOrigin: z.enum(['existing', 'created']),
    snsSubscriptionArn: awsSubscriptionArn,
    attachedActions: z
      .array(z.enum(['alarm', 'ok']))
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length, 'AWS action kinds must be unique'),
  })
  .strict()

const genericProviderKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/)
  .min(1)
  .max(64)

const genericProviderResourceSchema = z
  .object({
    kind: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/)
      .min(1)
      .max(64),
    name: z.string().min(1).max(190),
    id: providerId,
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => value.startsWith('https://'), {
        message: 'Provider resource URLs must use HTTPS',
      })
      .optional(),
    ownership: z.enum(['created', 'modified', 'referenced']),
    description: z.string().min(1).max(1000),
  })
  .strict()

/**
 * Provider-neutral receipt for APIs/CLIs the Agent can operate dynamically.
 * The setup is complete and inspectable, but automatic provider-side removal
 * remains limited to providers with a typed cleanup driver.
 */
const genericProviderWiringSchema = z
  .object({
    provider: z.literal('generic'),
    providerKey: genericProviderKey,
    providerLabel: z.string().min(1).max(100),
    integrationId: providerId,
    resourceId: providerId,
    resources: z.array(genericProviderResourceSchema).min(1).max(50),
    manualCleanupInstructions: z.string().min(1).max(4000),
  })
  .strict()

const singleMonitoringProviderWiringSchema = z
  .discriminatedUnion('provider', [
    grafanaProviderWiringSchema,
    gcpProviderWiringSchema,
    betterStackProviderWiringSchema,
    awsProviderWiringSchema,
    genericProviderWiringSchema,
  ])
  .superRefine((receipt, ctx) => {
    if (receipt.provider !== 'aws') return
    const alarmPrefix = `arn:aws:cloudwatch:${receipt.region}:${receipt.accountId}:alarm:`
    const topicPrefix = `arn:aws:sns:${receipt.region}:${receipt.accountId}:`

    if (!receipt.alarmArn.startsWith(alarmPrefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['alarmArn'],
        message: 'CloudWatch alarm ARN must match the receipt region and account',
      })
    }
    if (!receipt.snsTopicArn.startsWith(topicPrefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['snsTopicArn'],
        message: 'SNS topic ARN must match the receipt region and account',
      })
    }
    if (!receipt.snsSubscriptionArn.startsWith(`${receipt.snsTopicArn}:`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['snsSubscriptionArn'],
        message: 'SNS subscription ARN must belong to the receipt topic',
      })
    }
  })

const watchGroupProviderWiringSchema = z
  .object({
    provider: z.literal('watch_group'),
    groupId: objectIdString,
    partitionKey: z.string().min(1).max(1200),
    providerKey: genericProviderKey,
    integrationId: providerId,
    strategy: z.enum([
      'global_subscription',
      'policy_route',
      'shared_channel',
      'shared_topic',
      'provider_native_group',
      'polling',
    ]),
    memberKeys: z.array(z.string().min(1).max(1200)).min(1).max(50),
    eventMatches: z
      .array(
        z
          .object({
            memberKey: z.string().min(1).max(1200),
            /** Exact scalar values observed in the provider's verified test payload. */
            values: z.array(providerId).min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    /**
     * Exact existing receipts covered by the shared ingress. Repeated shared
     * resources are intentional: they preserve each member's reversible
     * attachment while the group cleanup driver deduplicates transport removal.
     */
    wirings: z.array(singleMonitoringProviderWiringSchema).min(1).max(50),
  })
  .strict()

export const monitoringProviderWiringSchema = z
  .discriminatedUnion('provider', [
    grafanaProviderWiringSchema,
    gcpProviderWiringSchema,
    betterStackProviderWiringSchema,
    awsProviderWiringSchema,
    genericProviderWiringSchema,
    watchGroupProviderWiringSchema,
  ])
  .superRefine((receipt, ctx) => {
    if (receipt.provider !== 'aws') return
    const alarmPrefix = `arn:aws:cloudwatch:${receipt.region}:${receipt.accountId}:alarm:`
    const topicPrefix = `arn:aws:sns:${receipt.region}:${receipt.accountId}:`

    if (!receipt.alarmArn.startsWith(alarmPrefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['alarmArn'],
        message: 'CloudWatch alarm ARN must match the receipt region and account',
      })
    }
    if (!receipt.snsTopicArn.startsWith(topicPrefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['snsTopicArn'],
        message: 'SNS topic ARN must match the receipt region and account',
      })
    }
    if (!receipt.snsSubscriptionArn.startsWith(`${receipt.snsTopicArn}:`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['snsSubscriptionArn'],
        message: 'SNS subscription ARN must belong to the receipt topic',
      })
    }
  })

export type MonitoringProviderWiring = z.infer<typeof monitoringProviderWiringSchema>
export type SingleMonitoringProviderWiring = z.infer<typeof singleMonitoringProviderWiringSchema>
export type WatchGroupProviderWiring = z.infer<typeof watchGroupProviderWiringSchema>
export type GrafanaProviderWiring = z.infer<typeof grafanaProviderWiringSchema>
export type GcpProviderWiring = z.infer<typeof gcpProviderWiringSchema>
export type BetterStackProviderWiring = z.infer<typeof betterStackProviderWiringSchema>
export type AwsProviderWiring = z.infer<typeof awsProviderWiringSchema>
export type GenericProviderWiring = z.infer<typeof genericProviderWiringSchema>

export type TriggerCleanupStatus = 'deleting' | 'cleanup_failed'

/** Keep persisted receipts deliberately small and secret-free. */
export function parseMonitoringProviderWiring(value: unknown): MonitoringProviderWiring {
  const parsed = monitoringProviderWiringSchema.parse(value)

  if (JSON.stringify(parsed).length > 64 * 1024) {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Provider wiring receipt is too large',
      },
    ])
  }

  return parsed
}
