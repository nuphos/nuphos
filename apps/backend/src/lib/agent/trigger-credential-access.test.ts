import { describe, expect, test } from 'bun:test'

import {
  credentialScopeCoversAll,
  intersectTriggerCredentialAccess,
  resolveTriggerCredentialMode,
  resolveTriggerGroupCredentialMode,
  triggerRunCredentialAccess,
} from './trigger-credential-access'

import type { AgentCredentialAccess } from './db'

function access(overrides: Partial<AgentCredentialAccess> = {}): AgentCredentialAccess {
  return {
    awsRoleIds: [],
    gcpServiceAccountIds: [],
    linodeAccountIds: [],
    hetznerAccountIds: [],
    betterStackIntegrationIds: [],
    uptimeKumaInstanceIds: [],
    jiraSiteIds: [],
    asanaAccountIds: [],
    tailscaleClientIds: [],
    zeaburIds: [],
    vantaIntegrationIds: [],
    secureframeIntegrationIds: [],
    updatedAt: new Date('2026-07-29T00:00:00.000Z'),
    updatedBy: 'session',
    ...overrides,
  }
}

describe('intersectTriggerCredentialAccess', () => {
  test('keeps only credentials approved in the snapshot and still accessible', () => {
    const approved = access({
      awsRoleIds: ['kept', 'revoked'],
      betterStackIntegrationIds: ['approved'],
    })
    const current = access({
      awsRoleIds: ['kept', 'new'],
      betterStackIntegrationIds: ['approved', 'new'],
    })

    const result = intersectTriggerCredentialAccess(approved, current)

    expect(result.awsRoleIds).toEqual(['kept'])
    expect(result.betterStackIntegrationIds).toEqual(['approved'])
    expect(result.updatedAt).toEqual(approved.updatedAt)
    expect(result.updatedBy).toBe('session')
  })

  test('does not introduce optional credential families absent from the snapshot', () => {
    const approved = access()
    const current = access({ azureAccountIds: ['new-azure'] })

    expect(intersectTriggerCredentialAccess(approved, current).azureAccountIds).toBeUndefined()
  })

  test('a connector granted after the snapshot never widens the Trigger', () => {
    // The case a UI-created Trigger used to hit: with no snapshot there was no
    // ceiling, so anything the principal gained later came along for the ride.
    const atCreation = access({ awsRoleIds: ['prod-readonly'] })
    const afterPromotion = access({ awsRoleIds: ['prod-readonly', 'prod-admin'] })

    expect(intersectTriggerCredentialAccess(atCreation, afterPromotion).awsRoleIds).toEqual([
      'prod-readonly',
    ])
  })

  test('keeps every selected-credential connector the snapshot approved', () => {
    const full = access({
      sentryAccountIds: ['sentry'],
      posthogIntegrationIds: ['posthog'],
      resendIntegrationIds: ['mail'],
      githubInstallationIds: ['github'],
      gitlabBindingIds: ['gitlab'],
      grafanaInstanceIds: ['grafana'],
      sonarqubeIntegrationIds: ['sonar'],
      notionIntegrationIds: ['notion'],
      upstashAccountIds: ['upstash'],
      cloudflareAccountIds: ['cloudflare'],
    })

    expect(intersectTriggerCredentialAccess(full, full)).toMatchObject({
      sentryAccountIds: ['sentry'],
      posthogIntegrationIds: ['posthog'],
      resendIntegrationIds: ['mail'],
      githubInstallationIds: ['github'],
      gitlabBindingIds: ['gitlab'],
      grafanaInstanceIds: ['grafana'],
      sonarqubeIntegrationIds: ['sonar'],
      notionIntegrationIds: ['notion'],
      upstashAccountIds: ['upstash'],
      cloudflareAccountIds: ['cloudflare'],
    })
  })

  test('a revoked connector drops out on the very next run', () => {
    const approved = access({ awsRoleIds: ['prod-admin'] })
    const afterRevocation = access({ awsRoleIds: [] })

    expect(intersectTriggerCredentialAccess(approved, afterRevocation).awsRoleIds).toEqual([])
  })
})

describe('triggerRunCredentialAccess', () => {
  test('a Trigger bound to every credential picks up a connector added later', () => {
    const atCreation = access({ awsRoleIds: ['prod'] })
    const afterNewConnector = access({ awsRoleIds: ['prod'], notionIntegrationIds: ['notion'] })

    const resolved = triggerRunCredentialAccess(
      { credentialMode: 'all', executionCredentialAccess: atCreation },
      afterNewConnector,
    )

    expect(resolved.notionIntegrationIds).toEqual(['notion'])
    expect(resolved).toBe(afterNewConnector)
  })

  test('an explicitly narrowed Trigger never widens', () => {
    const chosen = access({ awsRoleIds: ['staging'] })
    const current = access({ awsRoleIds: ['staging', 'prod'] })

    const resolved = triggerRunCredentialAccess(
      { credentialMode: 'selected', executionCredentialAccess: chosen },
      current,
    )

    expect(resolved.awsRoleIds).toEqual(['staging'])
  })

  test('a narrowed Trigger still loses what the principal can no longer reach', () => {
    const chosen = access({ awsRoleIds: ['staging', 'prod'] })
    const current = access({ awsRoleIds: ['staging'] })

    expect(
      triggerRunCredentialAccess(
        { credentialMode: 'selected', executionCredentialAccess: chosen },
        current,
      ).awsRoleIds,
    ).toEqual(['staging'])
  })

  test('a row written before the mode existed follows the current credentials', () => {
    // Nothing but the automatic default could have written this scope: the
    // Desktop form and the HTTP route have no credential picker.
    const legacySnapshot = access({ awsRoleIds: ['prod'] })
    const current = access({ awsRoleIds: ['prod'], cloudflareAccountIds: ['cf'] })

    expect(resolveTriggerCredentialMode({ executionCredentialAccess: legacySnapshot })).toBe('all')
    expect(
      triggerRunCredentialAccess({ executionCredentialAccess: legacySnapshot }, current)
        .cloudflareAccountIds,
    ).toEqual(['cf'])
  })

  test('a legacy row pinned by an Agent session keeps its ceiling', () => {
    const legacy = {
      executionCredentialAccess: access({ awsRoleIds: ['prod'] }),
      sourceContext: { sessionId: 'conv-1' },
    }
    const current = access({ awsRoleIds: ['prod'], cloudflareAccountIds: ['cf'] })

    expect(resolveTriggerCredentialMode(legacy)).toBe('selected')
    expect(triggerRunCredentialAccess(legacy, current).cloudflareAccountIds).toBeUndefined()
  })

  test('a legacy Watch Group scope is treated as a choice', () => {
    expect(resolveTriggerGroupCredentialMode({ executionCredentialAccess: access() })).toBe(
      'selected',
    )
    expect(resolveTriggerGroupCredentialMode({})).toBe('all')
  })
})

describe('credentialScopeCoversAll', () => {
  test('a session holding everything the principal can reach expresses no narrowing', () => {
    const current = access({ awsRoleIds: ['prod'], notionIntegrationIds: ['notion'] })

    expect(credentialScopeCoversAll(current, current)).toBe(true)
  })

  test("a session missing one of the principal's credentials is a narrowing", () => {
    const scope = access({ awsRoleIds: ['prod'] })
    const current = access({ awsRoleIds: ['prod'], notionIntegrationIds: ['notion'] })

    expect(credentialScopeCoversAll(scope, current)).toBe(false)
  })
})
