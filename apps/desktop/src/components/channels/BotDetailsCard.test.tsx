import assert from 'node:assert/strict'

import { beforeEach, mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

mock.module('../agent/AgentAvatar', () => ({
  AgentAvatar: ({ size }: { size: number }) =>
    createElement('span', { 'data-avatar-size': String(size) }),
}))
mock.module('../agent/panel/ConversationTitleEditor', () => ({
  RenameConversationDialog: () => createElement('div', { role: 'dialog' }, 'Edit Bot dialog'),
}))
// The standard confirm, as a plain dialog: its title, body and confirm button.
mock.module('../ConfirmDialog', () => ({
  ConfirmDialog: (props: {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    destructive?: boolean
    onConfirm: () => Promise<void>
    onClose: () => void
  }) =>
    props.open
      ? createElement(
          'div',
          { role: 'alertdialog', 'data-destructive': String(Boolean(props.destructive)) },
          createElement('h2', null, props.title),
          createElement('p', null, props.description),
          createElement(
            'button',
            { onClick: () => void props.onConfirm().then(props.onClose) },
            props.confirmLabel,
          ),
        )
      : null,
}))

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
  // The card announces a fresh start on the window, in the window's own event type.
  CustomEvent: dom.CustomEvent,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const startedFresh: unknown[][] = []

Object.assign(dom, {
  api: {
    agentStartBotFresh: (...args: unknown[]) => {
      startedFresh.push(args)

      return Promise.resolve({ at: '2026-11-21T10:00:00.000Z' })
    },
  },
})
beforeEach(() => {
  startedFresh.length = 0
})

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
        runtimeLabel: 'MacBook',
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

test("the card shows the Bot's face, name and where it runs, with Edit Bot for its owner", async () => {
  const card = await render({ onOpenTask: () => null, canOpenDesktop: true })

  assert.ok(card.container.querySelector('[data-avatar-size="72"]'))
  assert.match(card.container.textContent, /Scout/)
  assert.match(card.container.textContent, /MacBook · Claude Code/)
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

test('its owner gets Replace beside Task and Desktop, which confirms, then starts the Bot fresh', async () => {
  let edited = 0
  const card = await render({
    onOpenTask: () => null,
    canOpenDesktop: true,
    onEdited: () => {
      edited++
    },
  })
  const row = card.button('Task')?.parentElement

  assert.deepEqual(
    [...(row?.querySelectorAll('button') ?? [])].map((button) => button.textContent),
    ['Task', 'Desktop', 'Replace'],
  )
  await act(async () => card.button('Replace')?.click())
  const dialog = dom.document.querySelector('[role="alertdialog"]')

  assert.equal(dialog?.querySelector('h2')?.textContent, 'Start Scout fresh?')
  assert.match(
    dialog?.querySelector('p')?.textContent ?? '',
    /keeps its name, instructions, connections, sharing and helper Bots/,
  )
  assert.equal(dialog?.getAttribute('data-destructive'), 'false')
  assert.deepEqual(startedFresh, [])
  const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent === 'Replace',
  )

  await act(async () => confirm?.click())
  assert.deepEqual(startedFresh, [['bot', 'team']])
  assert.equal(edited, 1)
  assert.equal(dom.document.querySelector('[role="alertdialog"]'), null)
  await card.unmount()
})

test("someone else's Bot has no Replace", async () => {
  const card = await render({ owned: false, onOpenTask: () => null, canOpenDesktop: true })

  assert.ok(card.button('Task'))
  assert.equal(card.button('Replace'), undefined)
  await card.unmount()
})

test('while the Bot replies, Replace waits and opens nothing', async () => {
  const card = await render({ replying: true })
  const replace = card.button('Replace')

  assert.equal(replace?.getAttribute('aria-disabled'), 'true')
  await act(async () => replace?.click())
  assert.equal(dom.document.querySelector('[role="alertdialog"]'), null)
  assert.deepEqual(startedFresh, [])
  await card.unmount()
})
