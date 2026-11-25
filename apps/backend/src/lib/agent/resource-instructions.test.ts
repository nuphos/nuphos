import { expect, test } from 'bun:test'
import { OWNER_DECISION_NOTE } from './db/channel-notes'
import { resourceInstructions } from './resource-instructions'

test('a Nuphos channel wake points the owner to a decision card', () => {
  expect(resourceInstructions('channel:chan-1')).toContain(OWNER_DECISION_NOTE)
})

test('a Slack channel wake says who may be there and never points to a decision card', () => {
  const text = resourceInstructions('slack-channel:slack-1')

  expect(text).toContain('a Slack channel')
  expect(text).toContain('customers')
  expect(text).not.toContain('pointing to that card')
})
