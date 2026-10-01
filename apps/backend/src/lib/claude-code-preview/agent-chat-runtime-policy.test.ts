import { describe, expect, test } from 'bun:test'

import { previewSessionPrincipalChanged } from './agent-chat-runtime'

describe('OpenAB shared-conversation principal transitions', () => {
  test('requires a security-context reload when a serialized teammate turn changes actor', () => {
    expect(previewSessionPrincipalChanged({ userId: 'actor-a' }, 'actor-b')).toBe(true)
  })

  test('keeps the existing session context for another turn by the same actor', () => {
    expect(previewSessionPrincipalChanged({ userId: 'actor-a' }, 'actor-a')).toBe(false)
  })
})
