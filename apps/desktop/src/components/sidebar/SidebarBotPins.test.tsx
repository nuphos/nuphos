import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { Item, ItemMenuRequest } from './types'
import type { ContextMenuItem } from '../ContextMenu'

mock.module('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me' }) }))
mock.module('../agent/channelPeople', () => ({ leaveSession: () => Promise.resolve() }))
mock.module('./BotPinFace', () => ({ BotPinFace: () => null }))
mock.module('../ContextMenu', () => ({
  ContextMenu: ({ items }: { items: ContextMenuItem[] }) =>
    createElement(
      'div',
      { role: 'menu' },
      items.map((item) =>
        'label' in item
          ? createElement('div', { key: item.key, role: 'menuitem' }, item.label)
          : null,
      ),
    ),
}))

const { SidebarBotPins } = await import('./SidebarBotPins')
const { SidebarItemContextMenu } = await import('./item-context-menu')
const bot: Item = {
  key: 'agent-session:bot',
  label: 'Review Bot',
  enabled: true,
  bot: true,
  watching: false,
}
const ignore = () => {
  /* not under test */
}

function Harness() {
  const [menu, setMenu] = useState<ItemMenuRequest | null>(null)

  return createElement(
    'div',
    null,
    createElement(SidebarBotPins, {
      bots: [bot],
      pinned: () => true,
      toggle: ignore,
      onSelect: ignore,
      onItemMenu: setMenu,
      teamId: 'team',
      children: null,
    }),
    menu &&
      createElement(SidebarItemContextMenu, {
        menu,
        teamId: 'team',
        onClose: ignore,
        canFavorite: () => true,
        favoriteMatch: () => ({ key: bot.key, label: bot.label }),
        toggleFavorite: ignore,
        renameChat: ignore,
        archiveChat: () => Promise.resolve(),
        confirmArchiveBot: ignore,
        unlinkChat: () => Promise.resolve(),
      }),
  )
}

test('a pinned Bot right-click shows all the normal Bot menu actions', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  try {
    await act(() => root.render(createElement(Harness)))
    const button = container.querySelector('[data-bot-pin-key]')

    assert.ok(button)
    await act(() => {
      button.dispatchEvent(
        new dom.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 30,
        }),
      )
    })
    assert.deepEqual(
      [...container.querySelectorAll('[role=menuitem]')].map((item) => item.textContent),
      [
        'Unpin Bot',
        'Copy link',
        'Copy Bot ID',
        'Edit Bot',
        'Change avatar',
        'Watch Bot',
        'Archive Bot',
      ],
    )
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
