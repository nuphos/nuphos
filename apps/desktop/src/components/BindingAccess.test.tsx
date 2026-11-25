import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

let allowList = ['owner']

mock.module('../api', () => ({
  api: {
    atlasListTeamMembers: async () => [
      { id: 'owner', name: 'Alex', email: 'alex@example.com' },
      { id: 'viewer', name: 'Sam', email: 'sam@example.com' },
    ],
    atlasGetAwsAccountAccess: async () => ({ ownerUserId: 'owner', memberAllowList: allowList }),
  },
}))
mock.module('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'viewer' }) }))
mock.module('../hooks/useTeamRole', () => ({ useTeamRole: () => 'MEMBER' }))
mock.module('./ui/toast', () => ({ toast: { apiError: () => {} } }))

const { BindingAccessSection } = await import('./BindingAccess')

for (const [name, list, hint, absent] of [
  [
    'private',
    ['owner'],
    'Only its owner can change who may use it.',
    'Once it is shared, only team administrators can change who may use it.',
  ],
  [
    'shared with everyone',
    ['*'],
    'Once it is shared, only team administrators can change who may use it.',
    'Only its owner can change who may use it.',
  ],
  [
    'shared with specific members',
    ['owner', 'viewer'],
    'Once it is shared, only team administrators can change who may use it.',
    'Only its owner can change who may use it.',
  ],
] as const) {
  test(`a non-owner member sees the correct hint for a binding ${name}`, async () => {
    allowList = [...list]
    const dom = new Window()

    for (const [key, value] of Object.entries({
      window: dom,
      document: dom.document,
      HTMLElement: dom.HTMLElement,
      Element: dom.Element,
      Node: dom.Node,
      getComputedStyle: dom.getComputedStyle.bind(dom),
      requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
      cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
      IS_REACT_ACT_ENVIRONMENT: true,
    }))
      Object.defineProperty(globalThis, key, { configurable: true, value })
    const { createRoot } = await import('react-dom/client')
    const container = dom.document.createElement('div')

    dom.document.body.append(container)
    const root = createRoot(container as unknown as HTMLElement)

    try {
      await act(async () => {
        root.render(
          createElement(BindingAccessSection, {
            teamId: 'team',
            provider: 'aws',
            resourceId: 'account',
            secondaryId: 'role',
          }),
        )
      })
      assert.ok(
        container.textContent.includes(hint),
        `Expected ${hint}; received ${container.textContent}`,
      )
      assert.ok(!container.textContent.includes(absent))
      assert.equal(
        container.querySelector('[aria-disabled]')?.getAttribute('aria-disabled'),
        'true',
      )
      const save = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Save access',
      )

      assert.equal(save?.disabled, true)
    } finally {
      await act(async () => root.unmount())
      await dom.happyDOM.close()
    }
  })
}
