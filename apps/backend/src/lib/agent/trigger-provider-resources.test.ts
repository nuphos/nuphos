import { describe, expect, test } from 'bun:test'

import {
  buildManagedProviderResourcePlan,
  managedProviderResourcePlanForTrigger,
} from './trigger-provider-resources'

describe('managed provider resource projection', () => {
  test('ordinary and older triggers without a receipt have no provider resource section', async () => {
    await expect(
      managedProviderResourcePlanForTrigger({
        userId: 'user-1',
        name: 'Ordinary webhook',
        triggerType: 'webhook',
        messageTemplate: 'Do something',
        enabled: true,
        createdAt: new Date('2026-07-17T12:00:00.000Z'),
        updatedAt: new Date('2026-07-17T12:00:00.000Z'),
      }),
    ).resolves.toBeUndefined()
  })

  test('describes Grafana resources and exact cleanup behavior', () => {
    const plan = buildManagedProviderResourcePlan(
      {
        provider: 'grafana',
        integrationId: '64a64a64a64a64a64a64a64a',
        alertRuleUid: 'failed-pods',
        contactPointUid: 'nuphos-contact',
        contactPointName: 'nuphos-failed-pods',
        labelKey: 'nuphos_watch',
        labelValue: '64b64b64b64b64b64b64b64b',
        routingMode: 'policy',
      },
      { integrationLabel: 'Production Grafana', grafanaUrl: 'https://grafana.example.com/' },
      '2026-07-17T12:00:00.000Z',
    )

    expect(plan.provider).toBe('grafana')
    expect(plan.integrationLabel).toBe('Production Grafana')
    expect(plan.recordedAt).toBe('2026-07-17T12:00:00.000Z')
    expect(
      plan.resources.map((resource) => [resource.kind, resource.ownership, resource.cleanupAction]),
    ).toEqual([
      ['alert_rule', 'modified', 'detach'],
      ['notification_policy_route', 'created', 'detach'],
      ['contact_point', 'created', 'delete'],
    ])
    expect(plan.resources[0]?.url).toBe(
      'https://grafana.example.com/alerting/grafana/failed-pods/view',
    )
    expect(plan.resources[2]?.url).toBe(
      'https://grafana.example.com/alerting/notifications/receivers/bnVwaG9zLWZhaWxlZC1wb2Rz/edit',
    )
    expect(plan.cleanupSteps.at(-1)?.action).toBe('preserve')
  })

  test('explains restoration for converted Grafana direct routing', () => {
    const plan = buildManagedProviderResourcePlan({
      provider: 'grafana',
      integrationId: '64a64a64a64a64a64a64a64a',
      alertRuleUid: 'direct-rule',
      contactPointUid: 'nuphos-contact',
      contactPointName: 'nuphos-direct-rule',
      labelKey: 'nuphos_watch',
      labelValue: '64b64b64b64b64b64b64b64b',
      routingMode: 'direct_converted',
      previousNotificationSettings: { receiver: 'existing-pager' },
    })

    expect(plan.resources[0]?.cleanupAction).toBe('restore')
    expect(plan.cleanupSteps.some((step) => step.action === 'restore')).toBe(true)
    expect(plan.cleanupSteps.some((step) => step.description.includes('existing-pager'))).toBe(
      false,
    )
  })

  test('describes GCP policy attachment without claiming the policy will be deleted', () => {
    const policy = 'projects/example/alertPolicies/123'
    const channel = 'projects/example/notificationChannels/456'
    const plan = buildManagedProviderResourcePlan({
      provider: 'gcp',
      projectId: 'example',
      serviceAccountEmail: 'monitoring@example.iam.gserviceaccount.com',
      alertPolicyName: policy,
      alertPolicyOrigin: 'existing',
      notificationChannelName: channel,
    })

    expect(plan.resources.map((resource) => [resource.kind, resource.cleanupAction])).toEqual([
      ['alert_policy', 'preserve'],
      ['notification_channel_attachment', 'detach'],
      ['notification_channel', 'delete'],
    ])
    expect(plan.cleanupSteps).toContainEqual({
      action: 'preserve',
      description: 'Preserve the alert policy and every pre-existing notification channel.',
      resourceId: policy,
    })
  })

  test('records when GCP alert policy was created by Nuphos without overstating cleanup', () => {
    const plan = buildManagedProviderResourcePlan({
      provider: 'gcp',
      projectId: 'example',
      serviceAccountEmail: 'monitoring@example.iam.gserviceaccount.com',
      alertPolicyName: 'projects/example/alertPolicies/123',
      alertPolicyOrigin: 'created',
      notificationChannelName: 'projects/example/notificationChannels/456',
    })

    expect(plan.resources[0]).toEqual(
      expect.objectContaining({
        ownership: 'created',
        cleanupAction: 'preserve',
      }),
    )
  })

  test('does not invent GCP policy provenance for legacy receipts', () => {
    const plan = buildManagedProviderResourcePlan({
      provider: 'gcp',
      projectId: 'example',
      serviceAccountEmail: 'monitoring@example.iam.gserviceaccount.com',
      alertPolicyName: 'projects/example/alertPolicies/123',
      notificationChannelName: 'projects/example/notificationChannels/456',
    })

    expect(plan.resources[0]).toEqual(
      expect.objectContaining({
        ownership: 'modified',
        cleanupAction: 'preserve',
        description:
          'This legacy Watch did not record who created the alert policy; removal preserves it after detaching delivery.',
      }),
    )
  })

  test('marks Better Stack monitor as referenced and webhook as owned', () => {
    const plan = buildManagedProviderResourcePlan(
      {
        provider: 'betterstack',
        integrationId: '64a64a64a64a64a64a64a64a',
        monitorId: '1234',
        outgoingWebhookId: '5678',
        scope: 'monitor',
      },
      { integrationLabel: 'Production Uptime', betterStackDashboardTeamId: 't123' },
    )

    expect(plan.resources).toEqual([
      expect.objectContaining({
        kind: 'monitor',
        ownership: 'referenced',
        cleanupAction: 'preserve',
        url: 'https://uptime.betterstack.com/team/t123/monitors/1234',
      }),
      expect.objectContaining({
        kind: 'outgoing_webhook',
        ownership: 'created',
        cleanupAction: 'delete',
        url: 'https://uptime.betterstack.com/team/t123/integrations/webhooks/5678/edit',
      }),
    ])
  })

  test('falls back to the Better Stack dashboard when the optional dashboard team id is unavailable', () => {
    const plan = buildManagedProviderResourcePlan({
      provider: 'betterstack',
      integrationId: '64a64a64a64a64a64a64a64a',
      monitorId: '1234',
      outgoingWebhookId: '5678',
      scope: 'monitor',
    })

    expect(plan.resources.map((resource) => resource.url)).toEqual([
      'https://uptime.betterstack.com',
      'https://uptime.betterstack.com',
    ])
  })

  test('describes AWS alarm, SNS delivery, and non-destructive cleanup', () => {
    const alarmArn = 'arn:aws:cloudwatch:us-east-1:123456789012:alarm:High CPU'
    const topicArn = 'arn:aws:sns:us-east-1:123456789012:nuphos-watch'
    const subscriptionArn = `${topicArn}:11111111-2222-3333-4444-555555555555`
    const plan = buildManagedProviderResourcePlan({
      provider: 'aws',
      integrationId: '64a64a64a64a64a64a64a64a',
      accountId: '123456789012',
      region: 'us-east-1',
      alarmName: 'High CPU',
      alarmArn,
      alarmKind: 'metric',
      alarmOrigin: 'existing',
      snsTopicArn: topicArn,
      snsTopicOrigin: 'created',
      snsSubscriptionArn: subscriptionArn,
      attachedActions: ['alarm', 'ok'],
    })

    expect(plan.provider).toBe('aws')
    expect(plan.resources.map((resource) => [resource.kind, resource.cleanupAction])).toEqual([
      ['cloudwatch_alarm', 'preserve'],
      ['alarm_action_attachment', 'detach'],
      ['sns_topic', 'delete'],
      ['sns_subscription', 'delete'],
    ])
    expect(plan.resources[0]?.url).toContain('#alarmsV2:alarm/High%20CPU')
    expect(plan.cleanupSteps.at(-1)).toEqual({
      action: 'preserve',
      description: 'Preserve the CloudWatch alarm and every pre-existing alarm action.',
      resourceId: alarmArn,
    })
  })

  test('shows dynamically wired providers without pretending cleanup is automatic', () => {
    const plan = buildManagedProviderResourcePlan({
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
        'Remove the Nuphos webhook target from policy cpu-high before deleting the policy.',
    })

    expect(plan).toEqual(
      expect.objectContaining({
        provider: 'tencent-cloud',
        providerLabel: 'Tencent Cloud Monitor',
        integrationLabel: 'account:1234567890',
        cleanupMode: 'manual',
      }),
    )
    expect(plan.resources[0]).toEqual(
      expect.objectContaining({
        cleanupAction: 'manual',
      }),
    )
    expect(plan.cleanupSteps.some((step) => step.action === 'manual')).toBe(true)
  })
})
