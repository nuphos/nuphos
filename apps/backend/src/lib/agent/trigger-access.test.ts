import { describe, expect, test } from 'bun:test'

import {
  canAccessTeamTrigger,
  canModifyTriggerExecution,
  executionAuthorizationIsCurrent,
  triggerCreatedByUserId,
  triggerExecutionPrincipalFilter,
  triggerExecutionPrincipalId,
  triggerGroupExecutionIsHealthy,
} from './trigger-access'

/** Minimal evaluator for the subset of Mongo selectors this filter builds. */
function matchesFilter(
  filter: ReturnType<typeof triggerExecutionPrincipalFilter>,
  doc: Record<string, unknown>,
): boolean {
  return filter.$or.some((clause) =>
    Object.entries(clause).every(([field, expected]) => {
      if (
        expected &&
        typeof expected === 'object' &&
        '$exists' in (expected as Record<string, unknown>)
      ) {
        return (doc[field] !== undefined) === (expected as { $exists: boolean }).$exists
      }

      return doc[field] === expected
    }),
  )
}

describe('team Trigger access', () => {
  test('allows every active team role to read', () => {
    expect(canAccessTeamTrigger('VIEWER', 'read')).toBe(true)
    expect(canAccessTeamTrigger('EDITOR', 'read')).toBe(true)
    expect(canAccessTeamTrigger('ADMINISTRATOR', 'read')).toBe(true)
  })

  test('only the principal or an equal-or-higher role can change execution', () => {
    expect(canModifyTriggerExecution('editor', 'EDITOR', 'admin', 'ADMINISTRATOR')).toBe(false)
    expect(canModifyTriggerExecution('admin', 'ADMINISTRATOR', 'editor', 'EDITOR')).toBe(true)
    expect(canModifyTriggerExecution('editor-a', 'EDITOR', 'editor-b', 'EDITOR')).toBe(true)
    expect(canModifyTriggerExecution('principal', 'EDITOR', 'principal', 'ADMINISTRATOR')).toBe(
      true,
    )
    expect(canModifyTriggerExecution('editor', 'EDITOR', 'departed', undefined)).toBe(false)
    expect(canModifyTriggerExecution('admin', 'ADMINISTRATOR', 'departed', undefined)).toBe(true)
  })

  test('allows editors and administrators to manage', () => {
    expect(canAccessTeamTrigger('VIEWER', 'manage')).toBe(false)
    expect(canAccessTeamTrigger('EDITOR', 'manage')).toBe(true)
    expect(canAccessTeamTrigger('ADMINISTRATOR', 'manage')).toBe(true)
  })

  test('allows only administrators to delete', () => {
    expect(canAccessTeamTrigger('VIEWER', 'delete')).toBe(false)
    expect(canAccessTeamTrigger('EDITOR', 'delete')).toBe(false)
    expect(canAccessTeamTrigger('ADMINISTRATOR', 'delete')).toBe(true)
  })

  test('allows only administrators to move who a Trigger runs as', () => {
    // Editors may change what a Trigger does, but moving execution identity is
    // the one operation that changes whose authority it carries, so it stays
    // separate from manage and Administrator-only.
    expect(canAccessTeamTrigger('VIEWER', 'transfer')).toBe(false)
    expect(canAccessTeamTrigger('EDITOR', 'transfer')).toBe(false)
    expect(canAccessTeamTrigger('ADMINISTRATOR', 'transfer')).toBe(true)
    expect(canAccessTeamTrigger('EDITOR', 'manage')).toBe(true)
  })

  test('keeps legacy rows bound to their original owner identity', () => {
    expect(triggerCreatedByUserId({ userId: 'legacy-owner' })).toBe('legacy-owner')
    expect(triggerExecutionPrincipalId({ userId: 'legacy-owner' })).toBe('legacy-owner')
  })

  test('prefers the immutable execution principal over current managers', () => {
    const trigger = {
      userId: 'legacy-owner',
      createdByUserId: 'creator',
      executionPrincipalUserId: 'execution-principal',
    }

    expect(triggerCreatedByUserId(trigger)).toBe('creator')
    expect(triggerExecutionPrincipalId(trigger)).toBe('execution-principal')
  })
})

describe('execution principal selector', () => {
  const rows = [
    { name: 'explicit principal', userId: 'u', executionPrincipalUserId: 'target' },
    { name: 'rebound away', userId: 'target', executionPrincipalUserId: 'other' },
    { name: 'creator fallback', userId: 'u', createdByUserId: 'target' },
    { name: 'legacy owner fallback', userId: 'target' },
    { name: 'unrelated', userId: 'someone-else' },
  ]

  test('matches exactly the rows triggerExecutionPrincipalId resolves to the principal', () => {
    const filter = triggerExecutionPrincipalFilter('target')

    for (const row of rows) {
      expect([row.name, matchesFilter(filter, row)]).toEqual([
        row.name,
        triggerExecutionPrincipalId(row) === 'target',
      ])
    }
  })

  test('leaves a sibling partition bound to a different principal running', () => {
    const filter = triggerExecutionPrincipalFilter('departed')

    expect(
      matchesFilter(filter, { userId: 'departed', executionPrincipalUserId: 'still-here' }),
    ).toBe(false)
  })
})

describe('Watch Group execution health', () => {
  const grafana = { enabled: true, executionAuthorizationStatus: 'valid' }

  test('an ingress that has not run yet keeps the Group from reading healthy', () => {
    // The Grafana ingress verifying first must not vouch for a Better Stack
    // ingress that has never run and may have no access at all.
    expect(
      triggerGroupExecutionIsHealthy([
        grafana,
        { enabled: true, executionAuthorizationStatus: 'unchecked' },
      ]),
    ).toBe(false)
    expect(triggerGroupExecutionIsHealthy([grafana, { enabled: true }])).toBe(false)
  })

  test('a failed ingress keeps the Group from reading healthy', () => {
    expect(
      triggerGroupExecutionIsHealthy([
        grafana,
        { enabled: true, executionAuthorizationStatus: 'invalid' },
      ]),
    ).toBe(false)
  })

  test('a deliberately switched-off ingress does not block the Group', () => {
    expect(
      triggerGroupExecutionIsHealthy([
        grafana,
        { enabled: false, executionAuthorizationStatus: 'unchecked' },
        { enabled: false },
      ]),
    ).toBe(true)
  })

  test('an ingress disabled by its own failure still blocks the Group', () => {
    // A departed principal leaves its ingress disabled AND invalid. Excusing it
    // as "switched off" would let Better Stack's next successful run paper over
    // the Grafana failure that paused it.
    expect(
      triggerGroupExecutionIsHealthy([
        grafana,
        { enabled: false, executionAuthorizationStatus: 'invalid' },
      ]),
    ).toBe(false)
  })

  test('is healthy only once every enabled ingress has proven itself', () => {
    expect(triggerGroupExecutionIsHealthy([grafana, { ...grafana }])).toBe(true)
  })
})

describe('execution authorization write suppression', () => {
  test('treats a verified healthy row as needing no write', () => {
    expect(executionAuthorizationIsCurrent({ executionAuthorizationStatus: 'valid' })).toBe(true)
  })

  test('rewrites whenever the status is unproven or an error is still recorded', () => {
    expect(executionAuthorizationIsCurrent({})).toBe(false)
    expect(executionAuthorizationIsCurrent({ executionAuthorizationStatus: 'unchecked' })).toBe(
      false,
    )
    expect(executionAuthorizationIsCurrent({ executionAuthorizationStatus: 'invalid' })).toBe(false)
    expect(
      executionAuthorizationIsCurrent({
        executionAuthorizationStatus: 'valid',
        executionAuthorizationError: 'stale failure',
      }),
    ).toBe(false)
  })
})
