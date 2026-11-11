import assert from 'node:assert/strict'
import test from 'node:test'

import { matchedResourceLabel, searchPreview } from './matchedResource.ts'

import type { SessionResource } from '../../api/session-resource-types'

const pr = (number: number, title: string): SessionResource => ({
  id: String(number),
  provider: 'github',
  title,
  url: `https://github.com/nuphos/nuphos/pull/${String(number)}`,
  state: 'open',
  repository: 'nuphos/nuphos',
  number,
  linkedAt: '2026-11-11T00:00:00.000Z',
})

const resources = [
  pr(1830, 'fix(desktop): something else'),
  pr(1831, 'feat(desktop): Search and ⌘K in the Ink & Paper style'),
]

test('a PR number, with or without #, labels the row with that PR', () => {
  const label = '#1831 feat(desktop): Search and ⌘K in the Ink & Paper style'

  assert.equal(matchedResourceLabel(resources, '1831'), label)
  assert.equal(matchedResourceLabel(resources, '#1831'), label)
})

test('title text labels the row with the PR whose title matches', () => {
  assert.equal(
    matchedResourceLabel(resources, 'ink & paper'),
    '#1831 feat(desktop): Search and ⌘K in the Ink & Paper style',
  )
})

test('a Linear issue shows its title, which carries its identifier', () => {
  const issue: SessionResource = {
    id: 'i',
    provider: 'linear',
    title: 'NUPS-1342 Upgrade Next',
    url: 'https://linear.app/x',
    state: 'Todo',
    linkedAt: '2026-11-11T00:00:00.000Z',
  }

  assert.equal(matchedResourceLabel([issue], 'nups-1342'), 'NUPS-1342 Upgrade Next')
})

test('nothing matched means no label', () => {
  assert.equal(matchedResourceLabel(resources, '9999'), undefined)
  assert.equal(matchedResourceLabel(undefined, '1831'), undefined)
})

test('the second line is the PR only when the title and first message did not match', () => {
  const conversation = {
    title: 'Ship the palette',
    firstMessage: 'Please ship it',
    linkedResources: resources,
  }

  assert.equal(searchPreview(conversation, 'palette'), undefined)
  assert.equal(searchPreview(conversation, 'please'), 'Please ship it')
  assert.equal(
    searchPreview(conversation, '1831'),
    '#1831 feat(desktop): Search and ⌘K in the Ink & Paper style',
  )
})
