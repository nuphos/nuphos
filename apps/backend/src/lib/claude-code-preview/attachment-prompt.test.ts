import { describe, expect, test } from 'bun:test'

import { attachmentPrompt } from './openab-acp-lifecycle'

describe('attachmentPrompt', () => {
  test("sends the user's own text last, after everything Nuphos adds", () => {
    const { prompt } = attachmentPrompt(
      's',
      '/goal tests pass',
      [{ type: 'resource_link', name: 'a.png', uri: 'file:///a.png' }],
      {},
      '<nuphos_message_metadata>{}</nuphos_message_metadata>',
    )

    expect(prompt).toEqual([
      { type: 'text', text: '<nuphos_message_metadata>{}</nuphos_message_metadata>' },
      { type: 'resource_link', name: 'a.png', uri: 'file:///a.png' },
      { type: 'text', text: '/goal tests pass' },
    ])
  })

  test('omits empty blocks', () => {
    expect(attachmentPrompt('s', 'hello', [], {}).prompt).toEqual([{ type: 'text', text: 'hello' }])
  })
})
