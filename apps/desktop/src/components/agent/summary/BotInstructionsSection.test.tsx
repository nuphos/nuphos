import assert from 'node:assert/strict'

import { QueryClientProvider } from '@tanstack/react-query'
import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { AgentConversation } from '../../../api'

const dom = new Window()
const saves: unknown[][] = []
let answer: () => Promise<unknown> = () => Promise.resolve({ instructions: 'Ship weekly.' })

Object.assign(dom, {
  api: {
    agentSetBotInstructions: (...args: unknown[]) => {
      saves.push(args)

      return answer()
    },
  },
})
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { queryClient } = await import('../../../lib/query/client')
const { queryKeys } = await import('../../../lib/query/keys')
const { createRoot } = await import('react-dom/client')
const { BotInstructionsSection } = await import('./BotInstructionsSection')

const bot = (fields: Partial<AgentConversation>): AgentConversation => ({
  sessionId: 'bot',
  title: 'Ada',
  firstMessage: '',
  messageCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: '2026-01-01T00:00:00.000Z',
  avatar: '07-ada',
  ...fields,
})

async function mount(conversation: AgentConversation) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(BotInstructionsSection, { conversation, teamId: 'team' }),
      ),
    ),
  )
  const button = (name: string) =>
    [...container.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === name || node.textContent === name,
    )
  const textarea = () => container.querySelector('textarea')
  const type = async (text: string) => {
    const field = textarea()

    assert.ok(field)
    const setValue = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, 'value')

    await act(() => {
      setValue?.set?.call(field, text)
      field.dispatchEvent(new dom.Event('input', { bubbles: true }))
    })
  }
  const key = (init: KeyboardEventInit) =>
    act(() =>
      textarea()?.dispatchEvent(new dom.KeyboardEvent('keydown', { bubbles: true, ...init })),
    )

  return { container, button, textarea, type, key, unmount: () => act(() => root.unmount()) }
}

test('the owner edits a Bot’s instructions in place and saves them', async () => {
  queryClient.setQueryData(queryKeys.agentSessions('team'), [bot({ instructions: 'Old.' })])
  const view = await mount(bot({ instructions: 'Old.', isOwner: true }))
  const edit = view.button('Edit instructions')

  assert.ok(edit, 'the owner gets the pencil')
  await act(() => edit.click())
  assert.equal(view.textarea()?.value, 'Old.')
  assert.equal(view.button('Edit instructions'), undefined, 'the pencil hides while editing')
  assert.equal(view.button('Save')?.disabled, true, 'nothing to save yet')
  await view.type('Ship weekly.')
  await view.key({ key: 'Enter', metaKey: true })
  assert.deepEqual(saves.at(-1), ['bot', 'Ship weekly.', 'team'])
  assert.equal(view.textarea(), null, 'back to reading')
  const rows = queryClient.getQueryData<AgentConversation[]>(queryKeys.agentSessions('team'))

  assert.equal(rows?.[0]?.instructions, 'Ship weekly.', 'the list shows them at once')
  await view.unmount()
})

test('a refused save keeps the text and says why, under the field', async () => {
  answer = () => Promise.reject(new Error('Instructions must be at most 8000 characters'))
  const view = await mount(bot({ instructions: '', isOwner: true }))

  assert.ok(view.container.textContent.includes('None yet'))
  await act(() => view.button('Edit instructions')?.click())
  await view.type('Too long')
  await act(() => view.button('Save')?.click())
  assert.equal(view.textarea()?.value, 'Too long', 'still editing, text kept')
  assert.ok(view.container.querySelector('.text-error'), 'the reason shows under the field')
  // Esc leaves without saving.
  await view.key({ key: 'Escape' })
  assert.equal(view.textarea(), null)
  await view.unmount()
  answer = () => Promise.resolve({ instructions: 'Ship weekly.' })
})

test('anyone else reads them with no pencil', async () => {
  const view = await mount(bot({ instructions: 'Old.', isOwner: false }))

  assert.equal(view.button('Edit instructions'), undefined)
  assert.ok(view.container.textContent.includes('Old.'))
  await view.unmount()
})

/** happy-dom lays nothing out: says how tall the clamped box's text is, against its 160px cap. */
function textHeight(height: number) {
  const proto = dom.HTMLElement.prototype
  const saved = ['scrollHeight', 'clientHeight'].map(
    (name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const,
  )

  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => height })
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get: () => Math.min(height, 160),
  })

  return () => {
    for (const [name, descriptor] of saved)
      if (descriptor) Object.defineProperty(proto, name, descriptor)
      else Reflect.deleteProperty(proto, name)
  }
}

test('long instructions open in place under Show more, with no scroll box of their own', async () => {
  const restore = textHeight(600)
  const view = await mount(bot({ instructions: 'A long brief.' }))
  const more = view.button('Show more')

  assert.ok(more, 'the clamped text offers to open')
  assert.equal(more.getAttribute('aria-expanded'), 'false')
  assert.ok(!view.container.querySelector('.overflow-y-auto'), 'no second scrollbar')
  await act(() => more.click())
  const less = view.button('Show less')

  assert.ok(less, 'and to close again')
  assert.equal(less.getAttribute('aria-expanded'), 'true')
  assert.ok(!view.container.querySelector('.max-h-40'), 'open, it is not clamped')
  await act(() => less.click())
  assert.ok(view.button('Show more'))
  await view.unmount()
  restore()
})

test('short instructions show whole, with no Show more', async () => {
  const restore = textHeight(60)
  const view = await mount(bot({ instructions: 'Ship weekly.' }))

  assert.equal(view.button('Show more'), undefined)
  assert.equal(view.button('Show less'), undefined)
  await view.unmount()
  restore()
})
