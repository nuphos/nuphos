import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  HOME_CARD_CATALOG,
  cardKind,
  cardsOnHome,
  findCards,
  homeCardEntry,
  isKnownCard,
} from './homeCardCatalog.ts'

import type { HomeLayout } from '../../../types/team.ts'

const layout: HomeLayout = {
  team: true,
  github: [
    { id: 'a', kind: 'ci', repos: [], statuses: ['failed'] },
    { id: 'b', kind: 'pulls', repos: [], statuses: ['open'] },
    { id: 'c', kind: 'ci', repos: [], statuses: ['running'] },
  ],
  panels: [{ dashboardId: 'd', panelId: 'p' }],
  metrics: [{ id: 'm', kind: 'streak', range: '7d', scope: 'me' }],
}

test('every kind of card is listed once, in a category, with a size that fits the grid', () => {
  const kinds = HOME_CARD_CATALOG.map((c) => c.kind)

  assert.equal(new Set(kinds).size, kinds.length)
  assert.deepEqual(kinds.slice(0, 3), ['team', 'pulls', 'ci'])
  assert.equal(kinds.at(-1), 'panel')
  for (const card of HOME_CARD_CATALOG) {
    assert.ok(card.size.w >= 1 && card.size.w <= 12, card.kind)
    assert.ok(card.title && card.description, card.kind)
  }
})

test('cardKind reads the kind from a grid key, and a GitHub card from the layout', () => {
  assert.equal(cardKind('team'), 'team')
  assert.equal(cardKind('panel:d/p'), 'panel')
  assert.equal(cardKind('metric:runtime-mix:m1'), 'runtime-mix')
  assert.equal(cardKind('gh:a', layout), 'ci')
  assert.equal(cardKind('gh:b', layout), 'pulls')
  assert.equal(cardKind('gh:gone'), 'pulls')
  assert.equal(cardKind('something'), null)
})

test('cardsOnHome counts the cards of each kind', () => {
  assert.equal(cardsOnHome(layout, 'team'), 1)
  assert.equal(cardsOnHome({ ...layout, team: false }, 'team'), 0)
  assert.equal(cardsOnHome(layout, 'ci'), 2)
  assert.equal(cardsOnHome(layout, 'pulls'), 1)
  assert.equal(cardsOnHome(layout, 'panel'), 1)
  assert.equal(cardsOnHome(layout, 'streak'), 1)
  assert.equal(cardsOnHome(layout, 'sessions'), 0)
})

const kinds = (query: string, category: Parameters<typeof findCards>[1] = 'all') =>
  findCards(query, category).map((c) => c.kind)

test('findCards matches every word against titles, descriptions and keywords', () => {
  assert.equal(kinds('').length, HOME_CARD_CATALOG.length)
  assert.deepEqual(kinds('', 'github'), ['pulls', 'ci'])
  assert.deepEqual(kinds('heatmap'), ['team'])
  assert.deepEqual(kinds('  Workflows '), ['ci'])
  assert.deepEqual(kinds('merged slept'), ['pull-requests'])
  assert.deepEqual(kinds('github', 'metrics'), ['pull-requests'])
  assert.deepEqual(kinds('nothing like this'), [])
})

test('a kind this desktop does not know is left out, never shown as another', () => {
  const future = { id: 'f', kind: 'issues' } as unknown as HomeLayout['github'][number]

  assert.equal(homeCardEntry('issues'), undefined)
  assert.equal(homeCardEntry('streak')?.kind, 'streak')
  assert.equal(cardKind('metric:future-kind:m1'), null)
  assert.equal(cardKind('gh:f', { ...layout, github: [future] }), null)
  assert.equal(isKnownCard({ kind: 'streak' }), true)
  assert.equal(isKnownCard({ kind: 'future-kind' }), false)
  assert.equal(isKnownCard(future), false)
})
