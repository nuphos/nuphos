import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

mock.module('../agent/AgentAvatar', () => ({
  AgentAvatar: ({ size }: { size: number }) =>
    createElement('span', { 'data-avatar-size': String(size) }),
}))
mock.module('../agent/EditBotDialog', () => ({
  EditBotDialog: () => createElement('div', { role: 'dialog' }, 'Edit Bot dialog'),
}))

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
const { BotDetailsCard } = await import('./BotDetailsCard')

type Props = Parameters<typeof BotDetailsCard>[0]

async function render(props: Partial<Props>) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(async () => {
    root.render(
      createElement(BotDetailsCard, {
        teamId: 'team',
        bot: 'bot',
        title: 'Scout',
        agent: { provider: 'claude-code' },
        owned: true,
        canOpenDesktop: false,
        onEdited: () => null,
        ...props,
      }),
    )
  })

  return {
    container,
    button: (name: string) =>
      [...container.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === name || button.textContent === name,
      ),
    unmount: () => act(() => root.unmount()),
  }
}

test("the card shows the Bot's face and name, with Edit Bot for its owner", async () => {
  const card = await render({ onOpenTask: () => null, canOpenDesktop: true })

  assert.ok(card.container.querySelector('[data-avatar-size="56"]'))
  assert.match(card.container.textContent, /Scout/)
  // Where it runs is Bot details' Runtime section, not a line under the name.
  assert.doesNotMatch(card.container.textContent, /Claude Code/)
  assert.ok(card.button('Task'))
  assert.ok(card.button('Desktop'))
  const edit = card.button('Edit Bot')

  assert.ok(edit)
  await act(async () => edit.click())
  assert.match(card.container.textContent, /Edit Bot dialog/)
  await card.unmount()
})

test("a teammate's Bot has no Edit Bot, and no Task or Desktop it may not open", async () => {
  const card = await render({ owned: false })

  assert.equal(card.button('Edit Bot'), undefined)
  assert.equal(card.button('Task'), undefined)
  assert.equal(card.button('Desktop'), undefined)
  await card.unmount()
})

test('while the chat loads, the card holds its place without a name', async () => {
  const card = await render({ title: '', loading: true })

  assert.ok(card.container.querySelector('[aria-busy="true"]'))
  assert.equal(card.button('Edit Bot'), undefined)
  await card.unmount()
})

test('the card closes the details it leads, for owners and teammates alike', async () => {
  let closed = 0
  const card = await render({ owned: false, onClose: () => closed++ })
  const close = card.button('Close')

  assert.ok(close)
  await act(async () => close.click())
  assert.equal(closed, 1)
  await card.unmount()
})
