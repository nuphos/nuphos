import { beforeEach, describe, expect, test } from 'bun:test'

import { reportSweepFailure } from '@/lib/byos/agent-kubeconfig'
import { AppError } from '@/lib/errors'
import { useObservability } from '@/lib/test/doubles/observability'

const errors: { event: string; properties?: Record<string, unknown> }[] = []
const events: { level: string; event: string; properties?: Record<string, unknown> }[] = []

useObservability({
  logError: (event, _error, properties) => {
    errors.push({ event, properties: properties as Record<string, unknown> })
  },
  logEvent: (level, event, properties) => {
    events.push({ level, event, properties: properties as Record<string, unknown> })
  },
})

const CTX = {
  provider: 'gcp',
  teamId: '69e989027ab63e8d6a0ffcb6',
  account: 'zeabur-dedicated-servers',
}

beforeEach(() => {
  errors.length = 0
  events.length = 0
})

describe('reportSweepFailure', () => {
  test('a disabled Kubernetes API is a normal empty result, not an error', () => {
    reportSweepFailure(
      new AppError(
        502,
        'gcp_api_disabled',
        'Kubernetes Engine API is not enabled in project zeabur-dedicated-servers.',
      ),
      CTX,
    )

    expect(errors).toEqual([])
    expect(events).toEqual([
      {
        level: 'info',
        event: 'agent.kubeconfig.no_clusters',
        properties: {
          provider: 'gcp',
          team_id: CTX.teamId,
          account: CTX.account,
          reason: 'service_disabled',
        },
      },
    ])
  })

  test('a raw SERVICE_DISABLED verdict is read the same way', () => {
    reportSweepFailure(
      Object.assign(new Error('...is disabled'), { code: 7, reason: 'SERVICE_DISABLED' }),
      CTX,
    )

    expect(errors).toEqual([])
    expect(events[0]?.event).toBe('agent.kubeconfig.no_clusters')
  })

  test('a missing IAM role still reports a failed sweep', () => {
    reportSweepFailure(
      new AppError(
        403,
        'gcp_service_account_permission_denied',
        'no permission to container.clusters.list',
      ),
      CTX,
    )

    expect(events).toEqual([])
    expect(errors).toEqual([
      {
        event: 'agent.kubeconfig.enumerate_failed',
        properties: { provider: 'gcp', team_id: CTX.teamId, account: CTX.account },
      },
    ])
  })

  test('an unclassified failure still reports a failed sweep', () => {
    reportSweepFailure(new Error('socket hang up'), CTX)

    expect(events).toEqual([])
    expect(errors[0]?.event).toBe('agent.kubeconfig.enumerate_failed')
  })

  test('a nullish rejection does not throw on its way to the log', () => {
    expect(() => reportSweepFailure(undefined, CTX)).not.toThrow()
    expect(errors[0]?.event).toBe('agent.kubeconfig.enumerate_failed')
  })
})
