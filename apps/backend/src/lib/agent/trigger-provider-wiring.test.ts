import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import {
  isPotentialLegacyManagedWatch,
  removeManagedGrafanaRoute,
  targetsManagedWebhook,
} from './trigger-provider-cleanup'
import { parseMonitoringProviderWiring } from './trigger-provider-wiring'

import type { GrafanaProviderWiring } from './trigger-provider-wiring'

const receipt: GrafanaProviderWiring = {
  provider: 'grafana',
  integrationId: '507f1f77bcf86cd799439011',
  alertRuleUid: 'rule-1',
  contactPointUid: 'cp-1',
  contactPointName: 'nuphos-certificates',
  labelKey: 'nuphos_watch',
  labelValue: '507f191e810c19729de860ea',
  routingMode: 'policy',
}

describe('monitoring provider wiring receipts', () => {
  test('accepts the minimal secret-free receipts for every Watch provider', () => {
    expect(parseMonitoringProviderWiring(receipt)).toEqual(receipt)
    expect(
      parseMonitoringProviderWiring({
        provider: 'gcp',
        projectId: 'atlas-prod',
        serviceAccountEmail: 'nuphos@atlas-prod.iam.gserviceaccount.com',
        alertPolicyName: 'projects/atlas-prod/alertPolicies/123',
        notificationChannelName: 'projects/atlas-prod/notificationChannels/456',
      }).provider,
    ).toBe('gcp')
    expect(
      parseMonitoringProviderWiring({
        provider: 'betterstack',
        integrationId: '507f1f77bcf86cd799439011',
        outgoingWebhookId: '789',
        monitorId: '42',
        scope: 'monitor',
      }).provider,
    ).toBe('betterstack')
    expect(
      parseMonitoringProviderWiring({
        provider: 'aws',
        integrationId: '507f1f77bcf86cd799439011',
        accountId: '123456789012',
        region: 'us-east-1',
        alarmName: 'HighCPU',
        alarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:HighCPU',
        alarmKind: 'metric',
        alarmOrigin: 'existing',
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:nuphos-high-cpu',
        snsTopicOrigin: 'created',
        snsSubscriptionArn:
          'arn:aws:sns:us-east-1:123456789012:nuphos-high-cpu:11111111-2222-3333-4444-555555555555',
        attachedActions: ['alarm', 'ok'],
      }).provider,
    ).toBe('aws')
    expect(
      parseMonitoringProviderWiring({
        provider: 'generic',
        providerKey: 'tencent-cloud',
        providerLabel: 'Tencent Cloud Monitor',
        integrationId: 'account:1234567890',
        resourceId: 'policy:cpu-high',
        resources: [
          {
            kind: 'alarm_policy',
            name: 'High CPU',
            id: 'policy:cpu-high',
            url: 'https://console.cloud.tencent.com/monitor/alarm2/policy',
            ownership: 'created',
            description: 'Cloud Monitor alarm policy created for this Watch.',
          },
        ],
        manualCleanupInstructions:
          'Remove the Nuphos webhook notification target from policy cpu-high, then delete the target if no other policy uses it.',
      }).provider,
    ).toBe('generic')
    expect(
      parseMonitoringProviderWiring({
        provider: 'watch_group',
        groupId: '507f1f77bcf86cd799439012',
        partitionKey: '["grafana","507f1f77bcf86cd799439011"]',
        providerKey: 'grafana',
        integrationId: '507f1f77bcf86cd799439011',
        strategy: 'policy_route',
        memberKeys: ['member-a', 'member-b'],
        eventMatches: [
          { memberKey: 'member-a', values: ['rule-a'] },
          { memberKey: 'member-b', values: ['rule-b'] },
        ],
        wirings: [
          receipt,
          {
            ...receipt,
            alertRuleUid: 'rule-2',
          },
        ],
      }).provider,
    ).toBe('watch_group')
  })

  test('rejects every field outside the strict provider receipt allowlist', () => {
    expect(() => parseMonitoringProviderWiring({ ...receipt, webhookSecret: 'nope' })).toThrow()
    expect(() =>
      parseMonitoringProviderWiring({
        ...receipt,
        routingMode: 'direct_converted',
        previousNotificationSettings: {
          receiver: 'pager',
          headers: { Authorization: 'Bearer nope' },
        },
      }),
    ).toThrow()
    expect(() =>
      parseMonitoringProviderWiring({
        ...receipt,
        routingMode: 'direct_converted',
        previousNotificationSettings: {
          receiver: 'pager',
          cookie: 'session=nope',
        },
      }),
    ).toThrow()
    expect(() =>
      parseMonitoringProviderWiring({
        provider: 'generic',
        providerKey: 'Tencent Cloud',
        providerLabel: 'Tencent Cloud Monitor',
        integrationId: 'account:123',
        resourceId: 'policy:1',
        resources: [
          {
            kind: 'alarm_policy',
            name: 'High CPU',
            id: 'policy:1',
            ownership: 'created',
            description: 'Created policy.',
            token: 'secret',
          },
        ],
        manualCleanupInstructions: 'Remove it.',
      }),
    ).toThrow()
  })

  test('rejects unsupported AWS partitions and mismatched receipt identities', () => {
    const awsReceipt = {
      provider: 'aws' as const,
      integrationId: '507f1f77bcf86cd799439011',
      accountId: '123456789012',
      region: 'us-east-1',
      alarmName: 'HighCPU',
      alarmArn: 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:HighCPU',
      alarmKind: 'metric' as const,
      alarmOrigin: 'existing' as const,
      snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:nuphos-high-cpu',
      snsTopicOrigin: 'created' as const,
      snsSubscriptionArn:
        'arn:aws:sns:us-east-1:123456789012:nuphos-high-cpu:11111111-2222-3333-4444-555555555555',
      attachedActions: ['alarm', 'ok'] as const,
    }

    expect(() =>
      parseMonitoringProviderWiring({
        ...awsReceipt,
        region: 'us-gov-west-1',
        alarmArn: 'arn:aws-us-gov:cloudwatch:us-gov-west-1:123456789012:alarm:HighCPU',
        snsTopicArn: 'arn:aws-us-gov:sns:us-gov-west-1:123456789012:nuphos-high-cpu',
        snsSubscriptionArn:
          'arn:aws-us-gov:sns:us-gov-west-1:123456789012:nuphos-high-cpu:subscription',
      }),
    ).toThrow()
    expect(() =>
      parseMonitoringProviderWiring({
        ...awsReceipt,
        alarmArn: 'arn:aws:cloudwatch:us-west-2:123456789012:alarm:HighCPU',
      }),
    ).toThrow('must match the receipt region and account')
    expect(() =>
      parseMonitoringProviderWiring({
        ...awsReceipt,
        alarmArn: 'arn:aws:cloudwatch:us-east-1:999999999999:alarm:HighCPU',
      }),
    ).toThrow('must match the receipt region and account')
    expect(() =>
      parseMonitoringProviderWiring({
        ...awsReceipt,
        snsSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:another-topic:subscription',
      }),
    ).toThrow('must belong to the receipt topic')
  })
})

describe('legacy Watch discovery gate', () => {
  const base = {
    userId: 'user-1',
    name: 'watch',
    triggerType: 'webhook' as const,
    enabled: true,
    source: 'agent' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  test('only scans provider APIs for persisted Watch ownership markers', () => {
    expect(
      isPotentialLegacyManagedWatch({
        ...base,
        messageTemplate: 'Grafana alert notification received (status: {{payload.status}}).',
      }),
    ).toBe(false)
    expect(
      isPotentialLegacyManagedWatch({
        ...base,
        legacyMonitoringProvider: 'grafana',
        messageTemplate: 'Forward this generic webhook to my issue tracker.',
      }),
    ).toBe(true)
    expect(
      isPotentialLegacyManagedWatch({
        ...base,
        source: 'user',
        messageTemplate: 'Grafana alert notification received.',
      }),
    ).toBe(false)
  })

  test('prefers the persisted legacy marker after the editable template changes', () => {
    expect(
      isPotentialLegacyManagedWatch({
        ...base,
        legacyMonitoringProvider: 'grafana',
        messageTemplate: 'Investigate the alert using the new playbook.',
      }),
    ).toBe(true)
  })
})

describe('provider webhook ownership', () => {
  const triggerId = '507f191e810c19729de860ea'

  test('requires the exact normalized webhook pathname', () => {
    expect(targetsManagedWebhook(`https://nuphos.example/webhooks/${triggerId}`, triggerId)).toBe(
      true,
    )
    expect(targetsManagedWebhook(`https://nuphos.example/webhooks/${triggerId}/`, triggerId)).toBe(
      true,
    )
    expect(
      targetsManagedWebhook(
        `https://nuphos.example/webhooks/${triggerId}?secret=redacted`,
        triggerId,
      ),
    ).toBe(true)
    expect(
      targetsManagedWebhook(`https://nuphos.example/relay?next=/webhooks/${triggerId}`, triggerId),
    ).toBe(false)
    expect(
      targetsManagedWebhook(`https://nuphos.example/prefix/webhooks/${triggerId}`, triggerId),
    ).toBe(false)
    expect(
      targetsManagedWebhook(`https://nuphos.example/webhooks/${triggerId}/suffix`, triggerId),
    ).toBe(false)
  })
})

describe('Grafana exact-route cleanup', () => {
  test('removes only the exact Nuphos leaf and preserves existing sibling routes and order', () => {
    const policy = {
      receiver: 'default',
      routes: [
        { receiver: 'pager', object_matchers: [['team', '=', 'infra']], continue: true },
        {
          receiver: receipt.contactPointName,
          object_matchers: [[receipt.labelKey, '=', receipt.labelValue]],
          continue: false,
        },
        {
          receiver: 'old-slack',
          object_matchers: [[receipt.labelKey, '=', receipt.labelValue]],
          continue: true,
        },
      ],
    }
    const result = removeManagedGrafanaRoute(policy, receipt)

    expect(result.removed).toBe(1)
    expect(result.policy.routes.map((route: { receiver: string }) => route.receiver)).toEqual([
      'pager',
      'old-slack',
    ])
    expect(policy.routes).toHaveLength(3)
  })

  test('does not remove a same-name receiver selected by a different label', () => {
    const policy = {
      receiver: 'default',
      routes: [
        {
          receiver: receipt.contactPointName,
          object_matchers: [[receipt.labelKey, '=', 'another-trigger']],
        },
      ],
    }

    expect(removeManagedGrafanaRoute(policy, receipt).removed).toBe(0)
  })

  test('removes the Nuphos and owned compatibility routes for a converted direct receiver', () => {
    const directReceipt: GrafanaProviderWiring = {
      ...receipt,
      routingMode: 'direct_converted',
      previousNotificationSettings: { receiver: 'existing-pager', group_wait: '30s' },
    }
    const policy = {
      receiver: 'default',
      routes: [
        {
          receiver: 'existing-pager',
          object_matchers: [[receipt.labelKey, '=', receipt.labelValue]],
          continue: true,
        },
        {
          receiver: receipt.contactPointName,
          object_matchers: [[receipt.labelKey, '=', receipt.labelValue]],
          continue: false,
        },
        { receiver: 'unrelated', object_matchers: [['service', '=', 'api']] },
      ],
    }
    const result = removeManagedGrafanaRoute(policy, directReceipt)

    expect(result.removed).toBe(2)
    expect(result.policy.routes).toEqual([
      { receiver: 'unrelated', object_matchers: [['service', '=', 'api']] },
    ])
  })

  test('fails closed when someone added children to the managed route', () => {
    const policy = {
      receiver: 'default',
      routes: [
        {
          receiver: receipt.contactPointName,
          object_matchers: [[receipt.labelKey, '=', receipt.labelValue]],
          routes: [{ receiver: 'externally-added' }],
        },
      ],
    }

    expect(() => removeManagedGrafanaRoute(policy, receipt)).toThrow(AppError)
  })
})
