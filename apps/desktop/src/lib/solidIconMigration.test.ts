import assert from 'node:assert/strict'
import { test } from 'node:test'

import { legacySolidIconFiles, solidIconFiles } from './solidIconMigration.ts'

test('new Desktop source files cannot introduce FontAwesome solid UI imports', () => {
  assert.deepEqual(
    solidIconFiles().filter((path) => !legacySolidIconFiles.has(path)),
    [],
  )
})
