import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { CredentialSelectorControl } from '../agent/panel/credentialSections'

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
const { EMPTY_CREDENTIAL_ACCESS, EMPTY_CREDENTIAL_OPTIONS } =
  await import('../agent/panel/constants')
const { isBotDetailsOpen, setBotDetailsOpen } = await import('../../lib/botDetailsPanel')
const { BotAccessSection } = await import('./BotAccessSection')
const { ChooseAccessBanner } = await import('./channelParts')
const { ChannelEmptyState } = await import('./ChannelEmptyState')

const credentials: CredentialSelectorControl = {
  options: EMPTY_CREDENTIAL_OPTIONS,
  value: { ...EMPTY_CREDENTIAL_ACCESS, deviceIds: ['mac'] },
  saving: false,
  onOpen: () => {},
  onChange: () => {},
}
const scrolled: Element[] = []

Object.defineProperty(dom.HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value(this: Element) {
    scrolled.push(this)
  },
})

async function mount(node: ReturnType<typeof createElement>) {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() => root.render(node))

  return { container, unmount: () => act(() => root.unmount()) }
}

const access = () => createElement(BotAccessSection, { credentials, owned: true })

test('the choose-access banner opens Bot details at the Access section', async () => {
  setBotDetailsOpen('bot', false)
  // Drawn without being asked for, the section stays where it is.
  const quiet = await mount(access())

  assert.deepEqual(scrolled, [])
  await quiet.unmount()

  const banner = await mount(createElement(ChooseAccessBanner, { bot: 'bot' }))
  const choose = [...banner.container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Choose',
  )

  assert.ok(choose)
  await act(() => choose.click())
  assert.equal(isBotDetailsOpen('bot'), true, 'Choose opens Bot details')
  // The details draw the section after the press: it scrolls into view once.
  const opened = await mount(access())
  const section = opened.container.querySelector('section[aria-label="Access"]')

  assert.ok(section)
  assert.deepEqual(scrolled, [section])

  // Pressed again while the section is drawn, it scrolls there again.
  await act(() => choose.click())
  assert.deepEqual(scrolled, [section, section])
  await opened.unmount()
  await banner.unmount()
})

test('a Bot not yet loaded has no Access section', async () => {
  const view = await mount(createElement(BotAccessSection, { credentials: undefined, owned: true }))

  assert.equal(view.container.querySelector('section'), null)
  await view.unmount()
})

// #4038: a Bot with nothing saved still reaches the team-wide kinds, so only "no computer" holds.
test("the banner says only that the Bot has no computer, under an empty chat's intro", async () => {
  const view = await mount(
    createElement(ChannelEmptyState, {
      faces: [],
      title: 'Ada',
      bot: true,
      firstReplyFailed: false,
      banner: createElement(ChooseAccessBanner),
    }),
  )
  const column = view.container.firstElementChild
  const intro = [...(column?.children ?? [])].findIndex((node) =>
    node.textContent.startsWith('This is where you and Ada get things done.'),
  )
  const banner = column?.lastElementChild

  assert.ok(intro >= 0)
  assert.equal(
    banner?.textContent,
    "This Bot can't use any computers yet. Choose what it may use.Choose",
  )
  assert.equal([...(column?.children ?? [])].indexOf(banner as Element), intro + 1)
  await view.unmount()
})
