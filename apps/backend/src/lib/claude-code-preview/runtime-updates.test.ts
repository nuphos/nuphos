import { afterAll, beforeEach, expect, test } from 'bun:test'

import { publishRuntimeRelease, restoreRuntimeReleases } from './runtime-release-testing'
import { runtimeUpdateStatus } from './runtime-updates'

afterAll(restoreRuntimeReleases)

beforeEach(async () => {
  await publishRuntimeRelease({ version: '0.3.1' })
})

test('a runtime reports the version its status page served', async () => {
  expect(await runtimeUpdateStatus('claude-code', { runtimeVersion: '0.3.1' })).toMatchObject({
    state: 'current',
    currentVersion: '0.3.1',
  })
  expect((await runtimeUpdateStatus('claude-code', { runtimeVersion: '0.3.0' })).state).toBe(
    'available',
  )
  expect((await runtimeUpdateStatus('claude-code', {})).state).toBe('unknown')
})
