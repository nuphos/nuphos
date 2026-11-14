import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import { addedProjects } from '../../lib/taskProjects'

import type { Item } from './types'

let picked = 0
let botPins: { bots: Item[]; pinned: (item: Item) => boolean } | undefined

mock.module('../../api', () => ({
  api: {
    selectLocalFolder: async () => {
      picked++

      return ['/work/example']
    },
  },
}))
mock.module('../ui/toast', () => ({ toast: { apiError: () => {} } }))
mock.module('./SidebarArchiveSection', () => ({ SidebarArchiveSection: () => null }))
mock.module('./SidebarBotPins', () => ({
  SidebarBotPins: (props: NonNullable<typeof botPins>) => {
    botPins = props

    return null
  },
}))
mock.module('./sections-list', () => ({ SidebarSectionList: () => null }))

test('an empty Tasks page can pick a project folder and still start a plain task', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    navigator: dom.navigator,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    HTMLButtonElement: dom.HTMLButtonElement,
    SVGElement: dom.SVGElement,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    localStorage: dom.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { SidebarPageList } = await import('./SidebarPageList')
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const selected: string[] = []
  const teamId = 'folder-button-regression'

  try {
    await act(() =>
      root.render(
        createElement(SidebarPageList, {
          page: 1,
          sections: [],
          onScroll: () => {},
          listProps: {
            scope: { kind: 'team', teamId },
            active: 'team.agent',
            teamView: true,
            newChatActive: true,
            archivingIds: new Set<string>(),
            isGroupCollapsed: () => false,
            toggleGroup: () => {},
            favoriteMatch: () => {},
            canFavorite: () => false,
            toggleFavorite: () => {},
            onItemMenu: () => {},
            onSelect: (key) => selected.push(key),
          },
        }),
      ),
    )
    const add = container.querySelector('[aria-label="Add project"]')

    assert.ok(add, 'folder picker must exist before the first task or project')
    await act(async () => (add as unknown as HTMLElement).click())
    assert.equal(picked, 0, 'opening the explanation must not launch the native picker')
    assert.ok(dom.document.body.textContent?.includes('Group related tasks in a local folder.'))
    const choose = [...dom.document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Choose folder',
    )

    assert.ok(choose)
    await act(async () => (choose as unknown as HTMLElement).click())
    assert.equal(picked, 1)
    assert.deepEqual(addedProjects(teamId), ['/work/example'])
    await act(() =>
      (container.querySelector('[aria-label="New task"]') as unknown as HTMLElement).click(),
    )
    assert.deepEqual(selected, ['team.agent'])
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

const row = (key: string, extra: Partial<Item>): Item => ({
  key,
  label: key,
  enabled: true,
  ...extra,
})

test('a stored Task pin under a Bot stays out of the Bot pin shelf', async () => {
  const { SidebarPageList } = await import('./SidebarPageList')
  const { renderToStaticMarkup } = await import('react-dom/server')

  renderToStaticMarkup(
    createElement(SidebarPageList, {
      page: 0,
      sections: [
        {
          title: 'Channels',
          items: [
            row('agent-session:bot', { bot: true }),
            row('agent-session:chat', { channel: true }),
            row('agent-session:task', {
              botNested: true,
              task: true,
              parentKey: 'agent-session:chat',
            }),
          ],
        },
      ],
      onScroll: () => {},
      listProps: {
        scope: { kind: 'team', teamId: 'pin-shelf' },
        active: 'team.agent',
        teamView: true,
        newChatActive: false,
        archivingIds: new Set<string>(),
        isGroupCollapsed: () => false,
        toggleGroup: () => {},
        // Every row has a stored pin, as an older Task pin does.
        favoriteMatch: (item) => ({ label: item.label, key: item.key }),
        canFavorite: () => true,
        toggleFavorite: () => {},
        onItemMenu: () => {},
        onSelect: () => {},
      },
    }),
  )
  assert.ok(botPins)
  assert.deepEqual(
    botPins.bots.filter(botPins.pinned).map((item) => item.key),
    ['agent-session:bot', 'agent-session:chat'],
  )
})
