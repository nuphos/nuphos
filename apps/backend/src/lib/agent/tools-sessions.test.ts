import { expect, test } from 'bun:test'

import { byCodeUnit } from '@/lib/agent/sort-order'

import { createSessionTools } from './tools-sessions'

test('exposes the past-conversation tools in a team', () => {
  expect(Object.keys(createSessionTools('u', 'c', 'team')).sort(byCodeUnit)).toEqual([
    'list_recent_conversations',
    'read_conversation',
  ])
})

test('offers nothing outside a team scope', () => {
  expect(createSessionTools('u', 'c', null)).toEqual({})
})
