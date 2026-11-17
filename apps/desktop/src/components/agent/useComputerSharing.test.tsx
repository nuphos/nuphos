import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useEffect } from 'react'

import type { ReactNode } from 'react'

const stopped: string[] = []
// A stop answered with an error instead, by whom.
const refused = new Map<string, Error>()
const toasts: string[] = []

mock.module('../ui/alert-dialog', () => ({
  AppAlertDialog: (props: {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    onConfirm: () => void
  }) =>
    props.open
      ? createElement(
          'div',
          { 'data-dialog': props.title },
          createElement('p', null, props.description),
          createElement('button', { type: 'button', onClick: props.onConfirm }, props.confirmLabel),
        )
      : null,
}))
mock.module('../ui/toast', () => ({
  toast: { apiError: (title: string) => toasts.push(title), success: () => {} },
}))

const { useComputerSharing } = await import('./useComputerSharing')
const { computerUseNeeded } = await import('./computerUse')

/** The backend's computer_use_required refusal, as it crosses IPC. */
const atlasError = (body: object) =>
  new Error(`Error invoking remote method: Error: __ATLAS_API_ERROR__${JSON.stringify(body)}`)
const refusal = (userIds: string[]) =>
  atlasError({
    code: 'computer_use_required',
    message: 'Adding this person also gives them use of Bryan’s Mac. Continue?',
    details: { userIds, computer: { deviceId: 'mac', label: 'Bryan’s Mac' } },
  })

test('the refusal names the computer and who lacks it', () => {
  assert.deepEqual(computerUseNeeded(refusal(['leo'])), {
    computer: 'Bryan’s Mac',
    userIds: ['leo'],
  })
  assert.deepEqual(computerUseNeeded(new Error('offline')), { computer: null, userIds: [] })
})

type Sharing = ReturnType<typeof useComputerSharing>

async function mount() {
  const dom = new Window()

  Object.assign(dom, {
    api: {
      agentStopConversationComputerUse: async (_s: string, _t: string, userId: string) => {
        const error = refused.get(userId)

        if (error) throw error
        stopped.push(userId)

        return { stopped: true, computer: { deviceId: 'mac', label: 'Bryan’s Mac' } }
      },
    },
  })
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let sharing: Sharing | null = null
  const Harness = () => {
    const value = useComputerSharing('chat', 'team')

    useEffect(() => {
      sharing = value
    })

    return value.dialogs as ReactNode
  }

  await act(() => root.render(createElement(Harness)))

  return { container, sharing: () => sharing!, unmount: () => act(() => root.unmount()) }
}

const click = (container: { querySelectorAll: (s: string) => Iterable<unknown> }, label: string) =>
  act(() =>
    [...(container.querySelectorAll('button') as Iterable<HTMLElement>)]
      .find((button) => button.textContent === label)!
      .click(),
  )

const people = (...ids: string[]) => ids.map((id) => ({ id }))

/** An invite of these people the owner confirmed giving the computer to. */
async function grantedTo(sharing: () => Sharing, ids: string[]) {
  await act(() =>
    sharing().confirmGrant(
      ids.length,
      async () => {},
      () => {},
    )(refusal(ids)),
  )
}

test('the invite says how far sharing goes, and Undo takes back only what it gave', async () => {
  stopped.length = 0
  const { container, sharing, unmount } = await mount()
  let invited = 0

  try {
    await act(() =>
      sharing().confirmGrant(
        2,
        async () => {
          invited++
        },
        () => {},
      )(refusal(['leo'])),
    )
    assert.ok(container.querySelector('[data-dialog="Also share Bryan’s Mac?"]'))
    assert.match(container.textContent ?? '', /run any chat on Bryan’s Mac, not just this one/)
    await click(container, 'Add and share')
    assert.equal(invited, 1)
    // Maya already used the computer before the invite: Undo leaves her be.
    await act(() => sharing().undoInvite(people('leo', 'maya'), async () => {}))
    assert.deepEqual(stopped, ['leo'])
    await act(() => sharing().undoInvite(people('leo'), async () => {}))
    assert.deepEqual(stopped, ['leo'])
  } finally {
    await unmount()
  }
})

test('removing someone who still uses the computer offers to stop it, and only then', async () => {
  stopped.length = 0
  const { container, sharing, unmount } = await mount()
  const applied: unknown[] = []
  const person = { id: 'leo', name: 'Leo' } as never
  const state = { generalAccess: 'none', participants: [] } as never

  try {
    await act(() => sharing().thenOffer((s) => applied.push(s), person)(state))
    assert.equal(applied.length, 1)
    assert.equal(container.querySelector('[data-dialog]'), null)
    await act(() =>
      sharing().thenOffer(
        (s) => applied.push(s),
        person,
      )({
        ...(state as object),
        computerStillShared: { deviceId: 'mac', label: 'Bryan’s Mac' },
      } as never),
    )
    assert.ok(container.querySelector('[data-dialog="Also stop sharing Bryan’s Mac with Leo?"]'))
    assert.deepEqual(stopped, [])
    await click(container, 'Stop sharing')
    assert.deepEqual(stopped, ['leo'])
  } finally {
    await unmount()
  }
})

test('a stop that failed stays on record, so Undo again takes it back', async () => {
  stopped.length = 0
  toasts.length = 0
  const { container, sharing, unmount } = await mount()

  try {
    await grantedTo(sharing, ['leo', 'ana'])
    await click(container, 'Add and share')
    refused.set('leo', new Error('timed out'))
    let left: { id: string }[] = []

    await act(async () => {
      left = await sharing().undoInvite(people('leo', 'ana'), async () => {})
    })
    assert.deepEqual(left, people('leo'))
    assert.deepEqual(stopped, ['ana'])
    assert.deepEqual(toasts, ['Failed to undo'])
    refused.clear()
    await act(async () => {
      left = await sharing().undoInvite(left, async () => {})
    })
    assert.deepEqual(left, [])
    assert.deepEqual(stopped, ['ana', 'leo'])
  } finally {
    refused.clear()
    await unmount()
  }
})

test('a removal failing part way still takes back what the removed had', async () => {
  stopped.length = 0
  toasts.length = 0
  const { container, sharing, unmount } = await mount()

  try {
    await grantedTo(sharing, ['leo', 'ana'])
    await click(container, 'Add and share')
    let left: { id: string }[] = []

    await act(async () => {
      left = await sharing().undoInvite(people('leo', 'ana'), async (person) => {
        if (person.id === 'ana') throw new Error('offline')
      })
    })
    assert.deepEqual(stopped, ['leo'])
    assert.deepEqual(left, people('ana'))
    await act(async () => {
      left = await sharing().undoInvite(left, async () => {})
    })
    assert.deepEqual(stopped, ['leo', 'ana'])
    assert.deepEqual(left, [])
  } finally {
    await unmount()
  }
})

test('nothing left to stop, or a backend without the stop, is not a failed Undo', async () => {
  stopped.length = 0
  toasts.length = 0
  const { container, sharing, unmount } = await mount()

  try {
    await grantedTo(sharing, ['leo', 'ana', 'kim'])
    await click(container, 'Add and share')
    refused.set('leo', atlasError({ code: 'nothing_to_stop', message: 'No longer by name' }))
    refused.set('ana', atlasError({ code: 'route_not_found', message: 'Route POST /x not found' }))
    refused.set('kim', atlasError({ code: 'not_found', message: 'Route POST /x not found' }))
    let left: { id: string }[] = []

    await act(async () => {
      left = await sharing().undoInvite(people('leo', 'ana', 'kim'), async () => {})
    })
    assert.deepEqual(left, [])
    assert.deepEqual(toasts, [])
  } finally {
    refused.clear()
    await unmount()
  }
})

test('an invite that gives nothing leaves nothing for its Undo to take back', async () => {
  stopped.length = 0
  const { container, sharing, unmount } = await mount()

  try {
    await grantedTo(sharing, ['leo'])
    await click(container, 'Add and share')
    // Leo was removed and kept the computer; inviting him again needs no grant.
    await act(() => sharing().startInvite())
    await act(() => sharing().undoInvite(people('leo'), async () => {}))
    assert.deepEqual(stopped, [])
  } finally {
    await unmount()
  }
})
