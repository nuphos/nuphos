import { describe, expect, test } from 'bun:test'

import { buildEmptyContentFilteredReplyEvent, EMPTY_CONTENT_FILTERED_REPLY_EVENT } from './events'

describe('buildEmptyContentFilteredReplyEvent', () => {
  test('records the content-filter event with name, finishReason, and data shape', () => {
    const fields = buildEmptyContentFilteredReplyEvent({
      conversationId: 's1',
      userId: 'u1',
      finishReason: 'content-filter',
      outputEmpty: true,
      modelId: 'claude-opus-5',
    })

    expect(fields).toEqual({
      conversationId: 's1',
      event: EMPTY_CONTENT_FILTERED_REPLY_EVENT,
      userId: 'u1',
      data: {
        finishReason: 'content-filter',
        outputEmpty: true,
        modelId: 'claude-opus-5',
      },
    })
    expect(EMPTY_CONTENT_FILTERED_REPLY_EVENT).toBe('agent.chat.empty_content_filtered_reply')
  })

  // F1: after sticky fallback activates, the finish path passes the EFFECTIVE
  // model id — so a refusal on the fallback model is attributed to it, not the
  // configured primary.
  test('attributes the event to the effective model id it is given', () => {
    const fields = buildEmptyContentFilteredReplyEvent({
      conversationId: 's1',
      userId: 'u1',
      finishReason: 'content-filter',
      outputEmpty: true,
      modelId: 'claude-opus-4-8',
    })

    expect(fields.data.modelId).toBe('claude-opus-4-8')
  })

  test('omits userId when not provided', () => {
    const fields = buildEmptyContentFilteredReplyEvent({
      conversationId: 's1',
      finishReason: 'content-filter',
      outputEmpty: false,
      modelId: 'claude-opus-5',
    })

    expect('userId' in fields).toBe(false)
    expect(fields.data.outputEmpty).toBe(false)
  })
})
