import { describe, expect, test } from 'bun:test'

import {
  decodeScopeSet,
  DEFAULT_POSTHOG_PERMISSIONS,
  encodeScopeSet,
  permissionsForScopes,
  POSTHOG_PRESETS,
  POSTHOG_RESOURCES,
  POSTHOG_SCOPE_CEILING,
  PosthogPermissionError,
  scopeDiff,
  scopesForPermissions,
} from './posthog-scopes'

describe('scopesForPermissions', () => {
  test('always carries the fixed scopes, and write implies read', () => {
    expect(
      scopesForPermissions({ insight: 'read', feature_flag: 'write', person: 'none' }),
    ).toEqual([
      'user:read',
      'project:read',
      'insight:read',
      'feature_flag:read',
      'feature_flag:write',
    ])
  })

  test('rejects unknown resources and write on read-only resources', () => {
    expect(() => scopesForPermissions({ billing: 'read' })).toThrow(PosthogPermissionError)
    expect(() => scopesForPermissions({ query: 'write' })).toThrow(PosthogPermissionError)
  })

  test('the read-only default requests no write scope', () => {
    expect(
      scopesForPermissions(DEFAULT_POSTHOG_PERMISSIONS).some((s) => s.endsWith(':write')),
    ).toBe(false)
  })

  test('every preset stays within the metadata ceiling', () => {
    const ceiling = new Set(POSTHOG_SCOPE_CEILING)

    for (const preset of POSTHOG_PRESETS) {
      expect(scopesForPermissions(preset.permissions).every((s) => ceiling.has(s))).toBe(true)
    }
  })
})

describe('permissionsForScopes', () => {
  test('reads the strongest level per resource and marks the rest as none', () => {
    const permissions = permissionsForScopes([
      'user:read',
      'insight:read',
      'feature_flag:read',
      'feature_flag:write',
    ])

    expect(permissions.insight).toBe('read')
    expect(permissions.feature_flag).toBe('write')
    expect(permissions.person).toBe('none')
    expect(Object.keys(permissions)).toEqual(POSTHOG_RESOURCES.map((resource) => resource.id))
  })

  test('round-trips a matrix', () => {
    const matrix = {
      ...DEFAULT_POSTHOG_PERMISSIONS,
      dashboard: 'write' as const,
      person: 'none' as const,
    }

    expect(permissionsForScopes(scopesForPermissions(matrix))).toEqual(matrix)
  })
})

describe('scope-set client ids', () => {
  test('encode and decode round-trip any set, independent of order', () => {
    const set = scopesForPermissions({ dashboard: 'write', insight: 'read' })

    expect(new Set(decodeScopeSet(encodeScopeSet(set)))).toEqual(new Set(set))
    expect(encodeScopeSet(set)).toBe(encodeScopeSet(set.toReversed()))
    expect(encodeScopeSet(['user:read', 'project:read'])).toBe('3')
  })

  test('different permission sets get different ids', () => {
    const readOnly = encodeScopeSet(scopesForPermissions(DEFAULT_POSTHOG_PERMISSIONS))
    const oneWrite = encodeScopeSet(
      scopesForPermissions({ ...DEFAULT_POSTHOG_PERMISSIONS, dashboard: 'write' }),
    )

    expect(readOnly).not.toBe(oneWrite)
  })

  test('rejects malformed, non-canonical and out-of-range masks', () => {
    for (const mask of ['', 'xyz', '03', 'f'.repeat(32)]) expect(decodeScopeSet(mask)).toBeNull()
  })
})

describe('scopeDiff', () => {
  test('reports scopes PostHog dropped and any it added', () => {
    expect(
      scopeDiff(
        ['user:read', 'insight:read', 'feature_flag:write'],
        ['user:read', 'insight:read', 'dashboard:read'],
      ),
    ).toEqual({ missingScopes: ['feature_flag:write'], extraScopes: ['dashboard:read'] })
  })
})
