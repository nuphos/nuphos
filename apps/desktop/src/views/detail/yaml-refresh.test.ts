import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeRefreshedYaml } from './yaml-refresh.ts'

test('refresh updates a clean YAML editor', () => {
  assert.deepEqual(mergeRefreshedYaml('old', 'old', 'new'), {
    yamlText: 'new',
    draftYaml: 'new',
  })
})

test('refresh preserves an in-progress YAML draft', () => {
  assert.deepEqual(mergeRefreshedYaml('old', 'local edit', 'new'), {
    yamlText: 'new',
    draftYaml: 'local edit',
  })
})
