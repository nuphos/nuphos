import { expect, test } from 'bun:test'

import { newerRuntimeVersion, stableRuntimeVersion } from './runtime-release'

test('release comparisons use numeric semver and never offer downgrades or prereleases', () => {
  expect(newerRuntimeVersion('0.1.10', '0.1.9')).toBe(true)
  expect(newerRuntimeVersion('0.2.0', '0.1.99')).toBe(true)
  expect(newerRuntimeVersion('0.1.3', '0.1.3')).toBe(false)
  expect(newerRuntimeVersion('0.1.3', '0.1.4')).toBe(false)
  expect(newerRuntimeVersion('0.1.5-beta.1', '0.1.4')).toBe(false)
  expect(stableRuntimeVersion('latest')).toBe(false)
  expect(stableRuntimeVersion(undefined)).toBe(false)
})
