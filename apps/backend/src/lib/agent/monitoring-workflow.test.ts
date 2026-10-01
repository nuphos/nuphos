import { describe, expect, test } from 'bun:test'

import {
  MONITORING_WORKFLOW_TOOL_GUIDANCE,
  inferLegacyMonitoringProvider,
  legacyMonitoringWatchDedupeKey,
  monitoringWatchDedupeKey,
  pendingWebhookProviderWiring,
} from './monitoring-workflow'

describe('monitoring workflow completion contract', () => {
  test('requires provider wiring, additive routing, read-back, and drill verification', () => {
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain(
      'load the generic monitoring-workflow skill BEFORE',
    )
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('A matching provider skill is optional')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('Discover an unknown provider dynamically')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('preserving every existing notification')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('read the provider configuration back')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('safely roll back')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('Watch this monitoring item:')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('authorizes additive provider-side writes')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain(
      'a dashboard chart or bare metric is not an alert condition',
    )
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('STOP and end the turn')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('Only a later explicit user acceptance')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('first-party slack_post')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('slack_not_connected')
    expect(MONITORING_WORKFLOW_TOOL_GUIDANCE).toContain('Never replace Nuphos Slack delivery')
  })

  test('marks a newly created webhook as not connected', () => {
    expect(pendingWebhookProviderWiring()).toEqual({
      status: 'sender_not_connected',
      workflowComplete: false,
      requiredNextAction: expect.stringContaining('Do not call the workflow live yet'),
    })
  })
})

const identity = {
  provider: 'grafana' as const,
  integrationId: 'grafana-binding-1',
  resourceId: 'alert-rule-1',
}

describe('monitoring Watch identity', () => {
  test('is stable for retries of the same user, team, provider, and resource', () => {
    expect(monitoringWatchDedupeKey('user-1', 'team-1', identity)).toBe(
      monitoringWatchDedupeKey('user-1', 'team-1', identity),
    )
  })

  test('separates teams, providers, integrations, and resources', () => {
    const baseline = monitoringWatchDedupeKey('user-1', 'team-1', identity)
    const variants = [
      monitoringWatchDedupeKey('user-1', 'team-2', identity),
      monitoringWatchDedupeKey('user-1', 'team-1', { ...identity, provider: 'gcp' }),
      monitoringWatchDedupeKey('user-1', 'team-1', {
        ...identity,
        integrationId: 'grafana-binding-2',
      }),
      monitoringWatchDedupeKey('user-1', 'team-1', { ...identity, resourceId: 'alert-rule-2' }),
    ]

    expect(new Set([baseline, ...variants]).size).toBe(variants.length + 1)
    expect(baseline).toMatch(/^watch:[a-f0-9]{64}$/)
  })

  test('converges teammates wiring the same resource onto one team Watch', () => {
    expect(monitoringWatchDedupeKey('user-2', 'team-1', identity)).toBe(
      monitoringWatchDedupeKey('user-1', 'team-1', identity),
    )
  })

  test('still separates personal Watches by owner', () => {
    expect(monitoringWatchDedupeKey('user-2', undefined, identity)).not.toBe(
      monitoringWatchDedupeKey('user-1', undefined, identity),
    )
  })

  test('offers the pre-team-ownership key so existing team Watches still match', () => {
    const legacy = legacyMonitoringWatchDedupeKey('user-1', 'team-1', identity)

    expect(legacy).toMatch(/^watch:[a-f0-9]{64}$/)
    expect(legacy).not.toBe(monitoringWatchDedupeKey('user-1', 'team-1', identity))
    expect(legacyMonitoringWatchDedupeKey('user-2', 'team-1', identity)).not.toBe(legacy)
    // A personal Watch never changed identity, so it has no legacy variant.
    expect(legacyMonitoringWatchDedupeKey('user-1', undefined, identity)).toBeNull()
  })

  test('structurally separates identity fields containing NUL bytes', () => {
    const left = monitoringWatchDedupeKey('user-1', 'team-1', {
      ...identity,
      integrationId: 'X\0Y',
      resourceId: 'Z',
    })
    const right = monitoringWatchDedupeKey('user-1', 'team-1', {
      ...identity,
      integrationId: 'X',
      resourceId: 'Y\0Z',
    })

    expect(left).not.toBe(right)
  })
})

describe('legacy Watch migration', () => {
  test('recognizes only the provider recipes stamped during startup migration', () => {
    expect(
      inferLegacyMonitoringProvider({
        triggerType: 'webhook',
        source: 'agent',
        messageTemplate: 'Grafana alert notification received (status: {{payload.status}}).',
      }),
    ).toBe('grafana')
    expect(
      inferLegacyMonitoringProvider({
        triggerType: 'webhook',
        source: 'user',
        messageTemplate: 'Grafana alert notification received.',
      }),
    ).toBeUndefined()
    expect(
      inferLegacyMonitoringProvider({
        triggerType: 'webhook',
        source: 'agent',
        messageTemplate: 'CloudWatch Alarm notification received.',
      }),
    ).toBe('aws')
  })
})
