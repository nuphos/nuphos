import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AssistantMessage } from './AssistantMessage'

import type { Message } from './model'

const notice = 'Not run: a new message cancelled this approval. Ask again if you still want it.'

function rendered(errorText: string, streaming: boolean) {
  const message: Message = {
    id: 'reply',
    role: 'assistant',
    createdAt: 2,
    parts: [
      {
        type: 'tool',
        toolCallId: 'command',
        toolName: 'Bash',
        state: 'output-error',
        input: { command: 'printf test' },
        errorText,
      },
      { type: 'text', text: 'Ready for your next request.' },
    ],
  }
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(AssistantMessage, { message, streaming, now: 2 }),
    ),
  )
  const window = new Window()

  window.document.body.innerHTML = html

  return window.document
}

for (const streaming of [true, false])
  test(`superseded approval guidance stays visible outside folded work (streaming=${streaming})`, () => {
    const document = rendered(notice, streaming)
    const line = document.querySelector('[role="status"]')

    assert.equal(line?.textContent, notice)
    assert.equal(line?.closest('[aria-hidden="true"], [inert]'), null)
    assert.equal(document.querySelectorAll('[role="status"]').length, 1)
  })

test('a normal denial or stop is not described as a new-message cancellation', () => {
  for (const reason of ['Permission denied', 'Permission request was cancelled'])
    assert.equal(rendered(reason, false).querySelector('[role="status"]'), null)
})
