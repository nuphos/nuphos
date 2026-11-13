import { describe, expect, test } from 'bun:test'

import {
  executionAuthorizationIsCurrent,
  triggerCreatedByUserId,
  triggerExecutionPrincipalFilter,
  triggerExecutionPrincipalId,
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
        return (doc[field] !== undefined) === expected.$exists
      }

      return doc[field] === expected
    }),
  )
}

describe('Trigger ownership', () => {
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

  test('does not match a Trigger already moved to another principal', () => {
    const filter = triggerExecutionPrincipalFilter('departed')

    expect(
      matchesFilter(filter, { userId: 'departed', executionPrincipalUserId: 'still-here' }),
    ).toBe(false)
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
