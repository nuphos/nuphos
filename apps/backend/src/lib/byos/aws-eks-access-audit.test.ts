// logEvent writes JSON lines to stdout, so asserting on the emitted record
// means swapping console out for the duration of each test.
/* eslint-disable no-console */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { logEksAccessMutation } from './aws-eks-access-audit'

const PRINCIPAL = 'arn:aws:iam::793407052998:role/ZeaburAccessRole'
const POLICY = 'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy'

const originalLog = console.log
const originalWarn = console.warn
let lines: string[] = []

function capture(...args: unknown[]): void {
  lines.push(String(args[0]))
}

function lastRecord(): Record<string, unknown> {
  return JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>
}

beforeEach(() => {
  lines = []
  console.log = capture
  console.warn = capture
})

afterEach(() => {
  console.log = originalLog
  console.warn = originalWarn
})

describe('logEksAccessMutation', () => {
  test('carries the human behind a connector-session CloudTrail event', () => {
    logEksAccessMutation('byos.aws.eks.access_policy_associated', {
      actor: {
        source: 'aws-accounts.clusters.kubeconfig',
        userId: 'user-1',
        userEmail: 'ops@example.com',
        teamId: 'team-1',
      },
      region: 'ap-east-2',
      clusterName: 'cluster-abc',
      principalArn: PRINCIPAL,
      policyArn: POLICY,
      outcome: 'associated',
      response: { $metadata: { requestId: 'req-123' } },
    })

    const record = lastRecord()

    expect(record.level).toBe('info')
    expect(record.event).toBe('byos.aws.eks.access_policy_associated')
    // The join key: identical to `requestID` on the CloudTrail event.
    expect(record.aws_request_id).toBe('req-123')
    expect(record.actor_user_id).toBe('user-1')
    expect(record.actor_user_email).toBe('ops@example.com')
    expect(record.actor_team_id).toBe('team-1')
    expect(record.actor_source).toBe('aws-accounts.clusters.kubeconfig')
    expect(record.aws_account_id).toBe('793407052998')
    expect(record.aws_region).toBe('ap-east-2')
    expect(record.cluster_name).toBe('cluster-abc')
  })

  test('records the agent session id when an agent turn caused the mutation', () => {
    logEksAccessMutation('byos.aws.eks.access_entry_created', {
      actor: {
        source: 'agent-sessions.aws.kubeconfig',
        userId: 'user-1',
        teamId: 'team-1',
        agentSessionId: 'sess-9',
      },
      region: 'ap-east-2',
      clusterName: 'cluster-abc',
      principalArn: PRINCIPAL,
      outcome: 'created',
      response: { $metadata: { requestId: 'req-456' } },
    })

    expect(lastRecord().actor_agent_session_id).toBe('sess-9')
  })

  test('an idempotent no-op is still logged — CloudTrail records it either way', () => {
    logEksAccessMutation('byos.aws.eks.access_entry_created', {
      actor: { source: 'agent-sessions.aws.kubeconfig', userId: 'user-1' },
      region: 'ap-east-2',
      clusterName: 'cluster-abc',
      principalArn: PRINCIPAL,
      outcome: 'already_exists',
      error: new Error('ResourceInUseException'),
    })

    const record = lastRecord()

    expect(record.outcome).toBe('already_exists')
    expect(record.error_message).toContain('ResourceInUseException')
    expect(record.level).toBe('info')
  })

  test('a failed mutation logs at warn', () => {
    logEksAccessMutation('byos.aws.eks.auth_mode_upgrade_requested', {
      region: 'ap-east-2',
      clusterName: 'cluster-abc',
      principalArn: PRINCIPAL,
      outcome: 'failed',
      error: new Error('AccessDeniedException'),
    })

    expect(lastRecord().level).toBe('warn')
  })

  test('an un-threaded caller is marked, never silently anonymous', () => {
    logEksAccessMutation('byos.aws.eks.access_entry_created', {
      region: 'ap-east-2',
      clusterName: 'cluster-abc',
      principalArn: PRINCIPAL,
      outcome: 'created',
    })

    const record = lastRecord()

    expect(record.actor_source).toBe('unattributed')
    expect(record.actor_user_id).toBeUndefined()
  })
})
