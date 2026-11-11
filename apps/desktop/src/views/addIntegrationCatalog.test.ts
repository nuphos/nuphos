import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGcpCredentialSections } from '../components/agent/panel/credentialSections.ts'

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

test('Firebase credential discovery keeps the existing GCP binding identifiers', () => {
  const [section] = buildGcpCredentialSections([
    {
      serviceAccountId: 'binding',
      projectId: 'example-project',
      serviceAccountEmail: 'connector@example.test',
    },
  ])

  assert.equal(section.title, 'Google Cloud / Firebase')
  assert.equal(section.provider, 'gcp')
  assert.equal(section.items[0].id, 'binding')
})
