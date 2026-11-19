import assert from 'node:assert/strict'
import { test } from 'node:test'

import { iconMigrationArea, solidIconFiles } from './solidIconMigration.ts'

test('resources UI icons stay Lucide-only', () => {
  assert.deepEqual(
    solidIconFiles().filter((path) => iconMigrationArea(path) === 'resources'),
    [],
  )
})
