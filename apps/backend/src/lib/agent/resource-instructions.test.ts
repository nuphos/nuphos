import { expect, test } from 'bun:test'
import { resourceInstructions } from './resource-instructions'

// How to act in a channel is in the system prompt's channel section, once per turn:
// a wake only says where the posts are, so it costs no tokens per wake.
test('a Nuphos channel wake names the channel kind and points to channel_read', () => {
  const text = resourceInstructions('channel:chan-1')

  expect(text).toContain('a Nuphos channel')
  expect(text).toContain('channel_read')
  expect(text.length).toBeLessThan(200)
})

test('a Slack channel wake says it is a Slack channel and never points to a decision card', () => {
  const text = resourceInstructions('slack-channel:slack-1')

  expect(text).toContain('a Slack channel')
  expect(text).not.toContain('pointing to that card')
})
