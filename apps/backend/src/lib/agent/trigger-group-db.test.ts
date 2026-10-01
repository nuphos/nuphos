import assert from 'node:assert/strict'
import test from 'node:test'

import { ObjectId } from 'mongodb'

import {
  isSharedIngressTriggerGroup,
  parseTriggerGroupMemberKey,
  triggerGroupPartitionKey,
} from './trigger-group-db'
import {
  assertTriggerGroupReadyForTest,
  eventMatchUsesOnlyStableResourceIdentity,
  matchConfiguredTriggerGroupMembers,
  triggerGroupIncidentScope,
} from './trigger-group-service'

import type { AgentTrigger } from './trigger-db'
import type { TriggerGroupMember } from './trigger-group-db'
import type { WatchGroupProviderWiring } from './trigger-provider-wiring'

await test('parseTriggerGroupMemberKey preserves the exact selected resource identity', () => {
  const key = JSON.stringify(['grafana', 'grafana-prod', 'alert-rule', 'rule-123'])

  assert.deepEqual(parseTriggerGroupMemberKey(key), {
    key,
    provider: 'grafana',
    integrationId: 'grafana-prod',
    kind: 'alert-rule',
    resourceId: 'rule-123',
  })
  assert.equal(parseTriggerGroupMemberKey('not-json'), null)
  assert.equal(parseTriggerGroupMemberKey(JSON.stringify(['grafana', 'missing'])), null)
})

await test('triggerGroupPartitionKey shares one ingress only within a provider integration', () => {
  assert.equal(
    triggerGroupPartitionKey({ provider: 'grafana', integrationId: 'prod' }),
    '["grafana","prod"]',
  )
  assert.notEqual(
    triggerGroupPartitionKey({ provider: 'grafana', integrationId: 'prod' }),
    triggerGroupPartitionKey({ provider: 'grafana', integrationId: 'staging' }),
  )
  assert.notEqual(
    triggerGroupPartitionKey({ provider: 'grafana', integrationId: 'prod' }),
    triggerGroupPartitionKey({ provider: 'gcp', integrationId: 'prod' }),
  )
})

await test('shared-ingress group guard excludes retained prototype documents', () => {
  assert.equal(
    isSharedIngressTriggerGroup({
      _id: new ObjectId(),
      name: 'legacy group',
      memberKeys: ['one', 'two'],
      expectedMemberCount: 2,
    }),
    false,
  )
  assert.equal(
    isSharedIngressTriggerGroup({
      members: [],
      partitions: [{ triggerId: new ObjectId() }],
    }),
    true,
  )
})

await test('shared ingress matches and scopes each selected member independently', () => {
  const members: TriggerGroupMember[] = [
    {
      key: 'member-a',
      provider: 'grafana',
      integrationId: 'prod',
      kind: 'alert-rule',
      resourceId: 'rule-a',
    },
    {
      key: 'member-b',
      provider: 'grafana',
      integrationId: 'prod',
      kind: 'alert-rule',
      resourceId: 'rule-b',
    },
  ]
  const matches = matchConfiguredTriggerGroupMembers({
    members,
    memberKeys: members.map((member) => member.key),
    eventMatches: [
      { memberKey: 'member-a', values: ['rule-a'] },
      { memberKey: 'member-b', values: ['rule-b'] },
    ],
    payload: {
      status: 'firing',
      alerts: [
        { status: 'resolved', labels: { nuphos_member: 'rule-a' } },
        { status: 'firing', labels: { nuphos_member: 'rule-b' } },
        { status: 'firing', labels: { nuphos_member: 'unselected-rule' } },
      ],
    },
  })

  assert.deepEqual(
    matches.map((match) => match.member.resourceId),
    ['rule-a', 'rule-b'],
  )
  assert.deepEqual(
    matches.map((match) => match.payload),
    [
      {
        status: 'resolved',
        alerts: [{ status: 'resolved', labels: { nuphos_member: 'rule-a' } }],
      },
      {
        status: 'firing',
        alerts: [{ status: 'firing', labels: { nuphos_member: 'rule-b' } }],
      },
    ],
  )
})

await test('shared ingress ignores payloads that contain no selected stable resource id', () => {
  const member: TriggerGroupMember = {
    key: 'member-a',
    provider: 'grafana',
    integrationId: 'prod',
    kind: 'alert-rule',
    resourceId: 'rule-a',
  }

  assert.deepEqual(
    matchConfiguredTriggerGroupMembers({
      members: [member],
      memberKeys: [member.key],
      eventMatches: [{ memberKey: member.key, values: ['rule-a'] }],
      payload: { status: 'firing', alerts: [{ labels: { alertname: 'other-rule' } }] },
    }),
    [],
  )
})

await test('event match aliases are limited to stable provider resource identities', () => {
  const member: TriggerGroupMember = {
    key: 'member-a',
    provider: 'gcp',
    integrationId: 'prod',
    kind: 'alert-policy',
    resourceId: 'projects/prod/alertPolicies/policy-123',
  }

  assert.equal(
    eventMatchUsesOnlyStableResourceIdentity(member, [member.resourceId, 'policy-123']),
    true,
  )
  assert.equal(
    eventMatchUsesOnlyStableResourceIdentity(member, [member.resourceId, 'firing']),
    false,
  )
})

await test('shared ingress scans deeply nested payloads without recursive stack growth', () => {
  const member: TriggerGroupMember = {
    key: 'member-a',
    provider: 'grafana',
    integrationId: 'prod',
    kind: 'alert-rule',
    resourceId: 'rule-a',
  }
  const payload: Record<string, unknown> = {}
  let cursor = payload

  for (let depth = 0; depth < 20_000; depth += 1) {
    const next: Record<string, unknown> = {}

    cursor.next = next
    cursor = next
  }
  cursor.value = member.resourceId

  assert.doesNotThrow(() =>
    matchConfiguredTriggerGroupMembers({
      members: [member],
      memberKeys: [member.key],
      eventMatches: [{ memberKey: member.key, values: [member.resourceId] }],
      payload,
    }),
  )
})

await test('each group member receives a stable and distinct incident scope', () => {
  assert.equal(triggerGroupIncidentScope('member-a'), triggerGroupIncidentScope('member-a'))
  assert.notEqual(triggerGroupIncidentScope('member-a'), triggerGroupIncidentScope('member-b'))
})

await test('Watch Group delivery test requires a complete member matcher receipt', () => {
  const groupId = new ObjectId()
  const triggerId = new ObjectId()
  const member: TriggerGroupMember = {
    key: 'member-a',
    provider: 'grafana',
    integrationId: 'prod',
    kind: 'alert-rule',
    resourceId: 'rule-a',
  }
  const now = new Date()
  const group = {
    _id: groupId,
    userId: 'user-1',
    teamId: new ObjectId().toString(),
    name: 'Production alerts',
    messageTemplate: 'Investigate {{payload}}',
    members: [member],
    partitions: [
      {
        key: '["grafana","prod"]',
        provider: 'grafana',
        integrationId: 'prod',
        memberKeys: [member.key],
        triggerId,
      },
    ],
    dedupeKey: 'group-test',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
  const providerWiring: WatchGroupProviderWiring = {
    provider: 'watch_group',
    groupId: groupId.toString(),
    partitionKey: group.partitions[0]!.key,
    providerKey: 'grafana',
    integrationId: member.integrationId,
    strategy: 'policy_route',
    memberKeys: [member.key],
    eventMatches: [{ memberKey: member.key, values: [member.resourceId] }],
    wirings: [
      {
        provider: 'grafana',
        integrationId: member.integrationId,
        alertRuleUid: member.resourceId,
        contactPointUid: 'contact-point-1',
        contactPointName: 'Nuphos',
        labelKey: 'nuphos_watch',
        labelValue: triggerId.toString(),
        routingMode: 'policy',
      },
    ],
  }
  const baseTrigger: AgentTrigger = {
    _id: triggerId,
    userId: group.userId,
    teamId: group.teamId,
    name: 'Grafana ingress',
    triggerType: 'webhook',
    messageTemplate: group.messageTemplate,
    enabled: true,
    providerWiring,
    createdAt: now,
    updatedAt: now,
  }

  assert.doesNotThrow(() => assertTriggerGroupReadyForTest(group, [baseTrigger]))
  assert.throws(
    () =>
      assertTriggerGroupReadyForTest(group, [
        {
          ...baseTrigger,
          providerWiring: {
            ...providerWiring,
            eventMatches: [],
          },
        },
      ]),
    /missing one or more selected member matchers/i,
  )
  assert.throws(
    () =>
      assertTriggerGroupReadyForTest(
        {
          ...group,
          members: [
            ...group.members,
            {
              ...member,
              key: 'member-b',
              resourceId: 'rule-b',
            },
          ],
        },
        [baseTrigger],
      ),
    /every selected member must be assigned to a shared provider ingress/i,
  )
})
