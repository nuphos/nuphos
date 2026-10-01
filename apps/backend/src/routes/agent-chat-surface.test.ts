// A chat-surface turn is told so explicitly rather than left to infer it from
// the rendered user message: an inference buried in the user's text loses to
// the explicit instructions around it, which is why the acknowledgement line
// never appeared when the prompt asked the model to notice "wrote in #channel".
import { describe, expect, test } from 'bun:test'

import { chatSurfaceMessage } from './agent'

describe('chatSurfaceMessage', () => {
  test('names the surface the reader is actually in', () => {
    expect(chatSurfaceMessage('a Slack thread')).toContain('a Slack thread')
  })

  test('says why the opening line matters, not just that it is required', () => {
    const message = chatSurfaceMessage('a Lark chat')

    expect(message).toContain('no evidence anyone picked their message up')
    expect(message).toContain('before your first tool call')
  })

  test('points at the prompt for the wording instead of restating it', () => {
    expect(chatSurfaceMessage('a Slack thread')).toContain('as the system prompt describes')
  })
})
