import assert from 'node:assert/strict'
import test from 'node:test'

import { CATALOG } from '../addIntegrationCatalog.ts'

import { groupCatalog } from './catalog-groups.ts'

import type { AddIntegrationKey, CatalogCategory } from '../addIntegrationCatalog'

const item = (key: AddIntegrationKey) => ({ key, name: key, description: '', haystack: key })

test('every connector in the catalog lands in exactly one group', () => {
  const grouped = groupCatalog(CATALOG).flatMap((group) => group.items.map((entry) => entry.key))
  const all = CATALOG.flatMap((category) => category.items.map((entry) => entry.key))

  assert.deepEqual([...grouped].sort(), [...all].sort())
})

test('groups put everyday tools before infrastructure', () => {
  assert.deepEqual(
    groupCatalog(CATALOG).map((group) => group.id),
    ['productivity', 'communication', 'code', 'cloud', 'monitoring', 'data'],
  )
})

test('a connector can move to the group that fits its use', () => {
  const categories: CatalogCategory[] = [
    { id: 'observability', title: '', items: [item('posthog'), item('sentry')] },
    { id: 'compliance', title: '', items: [item('sonarqube')] },
  ]
  const groups = groupCatalog(categories)

  assert.deepEqual(
    groups.map((group) => [group.id, group.items.map((entry) => entry.key)]),
    [
      ['code', ['sonarqube']],
      ['monitoring', ['sentry']],
      ['data', ['posthog']],
    ],
  )
})

test('a group lists its most used connectors first, whatever their category order', () => {
  const categories: CatalogCategory[] = [
    { id: 'email', title: '', items: [item('resend')] },
    { id: 'messaging', title: '', items: [item('lark'), item('slack')] },
  ]

  assert.deepEqual(
    groupCatalog(categories)[0].items.map((entry) => entry.key),
    ['slack', 'lark', 'resend'],
  )
})

test('a search that leaves a group empty drops the group', () => {
  const categories: CatalogCategory[] = [
    { id: 'document', title: '', items: [] },
    { id: 'databases', title: '', items: [item('mongodb')] },
  ]

  assert.deepEqual(
    groupCatalog(categories).map((group) => group.id),
    ['data'],
  )
})
