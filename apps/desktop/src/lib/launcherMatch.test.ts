import assert from 'node:assert/strict'
import { test } from 'node:test'

import { launcherMatchRank, withAddressOption } from './launcherMatch.ts'

import type { NewTabOption } from './launcherMatch.ts'

test('a label prefix outranks a word prefix, which outranks a substring', () => {
  assert.equal(launcherMatchRank('Terminal', 't'), 0)
  assert.equal(launcherMatchRank('Runtime terminal', 't'), 1)
  assert.equal(launcherMatchRank('Plans', 'la'), 2)
})

test('matching ignores case and surrounding spaces', () => {
  assert.equal(launcherMatchRank('Local terminal', '  LOC '), 0)
})

test('a label without the query does not match', () => {
  assert.equal(launcherMatchRank('Files', 'x'), null)
})

test('an empty query matches everything', () => {
  assert.equal(launcherMatchRank('Files', ' '), 0)
})

const option = (label: string): NewTabOption => ({
  id: label,
  label,
  icon: null,
  open: () => null,
})
const address = option('Open https://grafana.example.com in Browser')

test('the address row leads when no label equals the query', () => {
  const ranked = [option('grafana.example.com staging')]

  assert.deepEqual(withAddressOption(ranked, address, 'grafana.example.com'), [address, ...ranked])
})

test('an option whose label equals the query keeps first place over the address row', () => {
  const staging = option('grafana.example.com staging')
  const exact = option('Grafana.example.com')

  assert.deepEqual(withAddressOption([staging, exact], address, ' grafana.example.com '), [
    exact,
    address,
    staging,
  ])
})

test('without an address row the ranking is unchanged', () => {
  const ranked = [option('Files')]

  assert.equal(withAddressOption(ranked, null, 'files'), ranked)
})
