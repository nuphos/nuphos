import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

import type { Part } from './parts.ts'

let applyEvent: (parts: Part[], event: Record<string, unknown>) => Part[]
let normalizeAgentError: (message: unknown) => string

before(async () => {
  mock.module('../../../api.ts', { namedExports: { isNetworkError: () => false } })
  mock.module('../../../i18n/index.ts', { namedExports: { t: (text: string) => text } })
  mock.module('../../../lib/frontendErrorReporter.ts', {
    namedExports: { reportFrontendError: () => {} },
  })
  mock.module('../../../lib/ownedAgentStreams.ts', {
    namedExports: { markOwnedAgentStream: () => {} },
  })
  mock.module('./streamText.ts', { namedExports: { appendTextDelta: () => {} } })
  ;({ normalizeAgentError } = await import('./stall.ts'))
  ;({ applyEvent } = await import('./applyEvent.ts'))
})

// #4887: a tool-output-error frame whose errorText was not a string crashed the chat
// window, and every Reload replayed the same frame into the same crash.
test('a tool error whose text is not a string marks the call failed instead of throwing', () => {
  const started = applyEvent([], {
    type: 'tool-input-available',
    toolCallId: 'call-1',
    toolName: 'bash',
    input: { command: 'cat missing.txt' },
  })

  for (const errorText of [{ message: 'no such file', code: 2 }, 404, false, ['a', 'b']]) {
    const [part] = applyEvent(started, {
      type: 'tool-output-error',
      toolCallId: 'call-1',
      errorText,
    })

    assert.equal(part.type === 'tool' && part.state, 'output-error')
    assert.equal(part.type === 'tool' && part.errorText, JSON.stringify(errorText))
  }
  const [missing] = applyEvent(started, { type: 'tool-output-error', toolCallId: 'call-1' })

  assert.equal(missing.type === 'tool' && missing.errorText, 'Tool error')
})

test('error text still loses its diagnostic context tail', () => {
  assert.equal(normalizeAgentError('Boom\ncontext=phase=run streamId=s1'), 'Boom')
  assert.equal(normalizeAgentError(undefined), 'undefined')
})
