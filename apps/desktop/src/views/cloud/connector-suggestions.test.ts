import assert from 'node:assert/strict'
import test from 'node:test'

import { connectorSuggestions } from './connector-suggestions.ts'

import type { AddIntegrationKey, CatalogCategory } from '../addIntegrationCatalog'

const item = (key: AddIntegrationKey, name: string) => ({
  key,
  name,
  description: '',
  haystack: `${name} ${key}`.toLowerCase(),
})

const catalog: CatalogCategory[] = [
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    items: [item('hetzner', 'Hetzner Cloud'), item('aws', 'AWS')],
  },
  {
    id: 'source-control',
    title: 'Source control',
    items: [item('gitlab', 'GitLab'), item('github', 'GitHub')],
  },
]

const keys = (items: { key: string }[]) => items.map((i) => i.key)

test('an empty search suggests connectors not yet added, popular first', () => {
  assert.deepEqual(keys(connectorSuggestions(catalog, '  ', new Set())), [
    'github',
    'aws',
    'hetzner',
    'gitlab',
  ])
  assert.deepEqual(keys(connectorSuggestions(catalog, '', new Set(['github']))), [
    'aws',
    'hetzner',
    'gitlab',
  ])
})

test('a typed search lists every match in catalog order, installed ones too', () => {
  assert.deepEqual(keys(connectorSuggestions(catalog, 'Git', new Set(['github']))), [
    'gitlab',
    'github',
  ])
  assert.deepEqual(keys(connectorSuggestions(catalog, 'git hub', new Set())), ['github'])
  assert.deepEqual(keys(connectorSuggestions(catalog, 'nope', new Set())), [])
})
