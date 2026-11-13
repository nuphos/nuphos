import { describe, expect, test } from 'bun:test'

import { canManageTrigger, executionAuthorizationIsCurrent } from './trigger-access'

describe('Trigger ownership', () => {
  test("only the owner of the Trigger's Task may change it", () => {
    expect(canManageTrigger({ userId: 'task-owner' }, 'task-owner')).toBe(true)
    expect(canManageTrigger({ userId: 'task-owner' }, 'teammate')).toBe(false)
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
