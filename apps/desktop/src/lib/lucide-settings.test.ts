import assert from 'node:assert/strict'
import { test } from 'node:test'

import { iconMigrationArea, solidIconFiles } from './solidIconMigration.ts'

test('settings UI icons stay Lucide-only', () => {
  assert.deepEqual(
    solidIconFiles().filter((path) => iconMigrationArea(path) === 'settings'),
    [],
  )
})
