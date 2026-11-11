import assert from 'node:assert/strict'
import test from 'node:test'

import { CATALOG } from './addIntegrationCatalog.ts'

test('Firebase discovery reuses the Google Cloud connection entry and selection', () => {
  const matches = CATALOG.flatMap((category) => category.items).filter((item) =>
    item.haystack.includes('firebase'),
  )

  assert.equal(matches.length, 1)
  assert.equal(matches[0].key, 'gcp')
  assert.match(matches[0].name, /Firebase/)
  assert.match(matches[0].description, /project and app inventory/)
})
