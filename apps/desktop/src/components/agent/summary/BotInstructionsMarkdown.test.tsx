import assert from 'node:assert/strict'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, useState } from 'react'

import type { AgentConversation } from '../../../api/agent-types'

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
const { createRoot } = await import('react-dom/client')

const original =
  '# Role\n\nFollow **these rules**.\n\n- Keep `raw` text.\n- [Docs](https://example.com/docs)\n\n```js\nconst example = 1\n```\n\n<script>alert(1)</script>\n<div data-raw="yes">HTML</div>\n\n[unsafe](javascript:alert(1))'
const saves: string[] = []
let publish: (text: string) => void = () => {}

mock.module('../../../api', () => ({
  api: {
    agentSetBotInstructions: async (_id: string, text: string) => {
      saves.push(text)

      return { instructions: text }
    },
  },
  decideErrorToast: () => ({ action: 'show', description: 'Failed' }),
}))
mock.module('../../sidebar/agentSessions', () => ({
  setChatInstructions: async (_client: unknown, _team: string, _id: string, text: string) => {
    publish(text)
  },
}))
mock.module('../../ui/toast', () => ({ toast: { apiError: () => {} } }))
const { BotInstructionsSection } = await import('./BotInstructionsSection')

test('reads safe Markdown, edits original source, cancels unchanged and saves raw text', async () => {
  const container = document.createElement('div')

  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient()

  function Fixture() {
    const [text, setText] = useState(original)

    publish = setText

    return (
      <QueryClientProvider client={client}>
        <BotInstructionsSection
          teamId="team"
          conversation={
            {
              sessionId: 'bot',
              avatar: 'bot',
              isOwner: true,
              instructions: text,
            } as AgentConversation
          }
        />
      </QueryClientProvider>
    )
  }
  await act(() => root.render(<Fixture />))
  assert.equal(container.querySelector('h1')?.textContent, 'Role')
  assert.equal(container.querySelectorAll('li').length, 2)
  assert.ok(container.querySelector('[data-streamdown="strong"]'))
  assert.ok(container.querySelector('pre'))
  assert.ok(container.querySelector('a[href="https://example.com/docs"]'))
  assert.equal(container.querySelector('script, [data-raw], a[href^="javascript:"]'), null)
  assert.equal(container.querySelector('textarea'), null)
  const edit = () => container.querySelector<HTMLButtonElement>('[aria-label="Edit instructions"]')!

  await act(() => edit().click())
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!

  assert.equal(input.value, original)
  const cancel = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!

  await act(() => cancel.click())
  assert.equal(container.querySelector('textarea'), null)
  assert.equal(saves.length, 0)
  assert.equal(container.querySelector('h1')?.textContent, 'Role')
  await act(() => edit().click())
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
  const changed = `${original}\n\n**Changed**`

  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      changed,
    )
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.deepEqual(saves, [changed])
  assert.equal(container.querySelector('textarea'), null)
  assert.ok(container.textContent?.includes('Changed'))
  await act(() => root.unmount())
  client.clear()
})

test('raw HTML remains opt-in per surface, including memoized prop changes', async () => {
  const { MessageResponse } = await import('../MessageResponse')
  const container = document.createElement('div')
  const root = createRoot(container)
  const html = '<b>HTML label</b>'

  await act(() => root.render(<MessageResponse>{html}</MessageResponse>))
  assert.ok(container.querySelector('b'), 'existing callers still render sanitized HTML')
  await act(() => root.render(<MessageResponse disableRawHtml>{html}</MessageResponse>))
  assert.equal(container.querySelector('b'), null)
  await act(() => root.render(<MessageResponse>{html}</MessageResponse>))
  assert.ok(container.querySelector('b'), 'switching the prop back restores the default')
  await act(() => root.unmount())
})
