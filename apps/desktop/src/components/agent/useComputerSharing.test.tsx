import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useEffect } from 'react'

import type { ReactNode } from 'react'

type Notice = {
  title: string
  description: string
  action?: { label: string; onClick: () => void }
}

/** Every call the hook makes to the app's API, by method and the user it names. */
const calls: string[] = []
/** Who keeps use of the computer after their removal, and whose removal fails. */
const keeps = new Set<string>()
const failing = new Set<string>()
const errors: string[] = []
const notices: Notice[] = []

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
  toast: {
    apiError: (title: string) => errors.push(title),
    info: (title: string, description: string, opts?: { action?: Notice['action'] }) =>
      notices.push({ title, description, ...(opts?.action ? { action: opts.action } : {}) }),
  },
}))

const { useComputerSharing } = await import('./useComputerSharing')
const { computerUseNeeded } = await import('./computerUse')

const MAC = { deviceId: 'mac', label: 'Bryan’s Mac' }
const refusal = new Error(
  `Error invoking remote method: Error: __ATLAS_API_ERROR__${JSON.stringify({
    code: 'computer_use_required',
    message: 'Adding this person also gives them use of Bryan’s Mac. Continue?',
    details: { userIds: ['leo'], computer: MAC },
  })}`,
)

test('the refusal names the computer', () => {
  assert.deepEqual(computerUseNeeded(refusal), { computer: 'Bryan’s Mac' })
  assert.deepEqual(computerUseNeeded(new Error('offline')), { computer: null })
})

type Sharing = ReturnType<typeof useComputerSharing>
const nothing = () => null

/** Any API method: recorded, and answered as a removal is, with the computer when they keep it. */
const api = new Proxy(
  {},
  {
    get: (_target, method: string) => async (_session: string, _team: string, userId: string) => {
      calls.push(`${method} ${userId}`)
      if (failing.has(userId)) throw new Error('offline')

      return {
        generalAccess: 'none',
        participants: [],
        ...(keeps.has(userId) ? { computerStillShared: MAC } : {}),
      }
    },
  },
)

async function mount(onOpenComputers?: () => void) {
  const dom = new Window()

  Object.assign(dom, { api })
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    CustomEvent: dom.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createRoot } = await import('react-dom/client')
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let sharing: Sharing | null = null
  const at = { sessionId: 'chat', teamId: 'team', apply: nothing, onOpenComputers }
  const Harness = () => {
    const value = useComputerSharing(at)

    useEffect(() => {
      sharing = value
    })

    return value.dialog as ReactNode
  }

  await act(() => root.render(createElement(Harness)))

  return {
    container,
    sharing: () => sharing as unknown as Sharing,
    unmount: () => act(() => root.unmount()),
  }
}

function reset() {
  calls.length = 0
  errors.length = 0
  notices.length = 0
  keeps.clear()
  failing.clear()
}

const people = (...names: string[]) => names.map((name) => ({ id: name.toLowerCase(), name }))
const titles = () => notices.map((notice) => notice.title)

test('the invite says how far sharing goes, then invites giving the computer', async () => {
  reset()
  const { container, sharing, unmount } = await mount()
  let invited = 0

  try {
    const inviteGiving = async () => {
      invited++
    }

    await act(() => sharing().confirmGrant(1, inviteGiving, nothing)(refusal))
    assert.ok(container.querySelector('[data-dialog="Also share Bryan’s Mac?"]'))
    assert.match(container.textContent ?? '', /run any chat on Bryan’s Mac, not just this one/)
    await act(() =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Add and share')
        ?.click(),
    )
    assert.equal(invited, 1)
  } finally {
    await unmount()
  }
})

test('removing someone who keeps the computer only says so, with a way to its settings', async () => {
  reset()
  let opened = 0
  const { sharing, unmount } = await mount(() => opened++)

  try {
    keeps.add('leo')
    await act(() => sharing().removeEach(people('Leo'), nothing))
    assert.deepEqual(calls, ['agentRemoveConversationParticipant leo'])
    assert.equal(notices.length, 1)
    assert.equal(notices[0]?.title, 'Leo can still use Bryan’s Mac')
    assert.equal(
      notices[0]?.description,
      'Manage who can use it in the computer’s sharing settings.',
    )
    assert.equal(notices[0]?.action?.label, 'Open settings')
    notices[0]?.action?.onClick()
    assert.equal(opened, 1)
    // Someone who does not use the computer by name: no notice.
    notices.length = 0
    await act(() => sharing().removeEach(people('Ana'), nothing))
    assert.deepEqual(notices, [])
  } finally {
    await unmount()
  }
})

test('Undo takes people out of the chat only; one notice names who keeps the computer', async () => {
  reset()
  const { sharing, unmount } = await mount()

  try {
    keeps.add('leo')
    keeps.add('kim')
    let left: { id: string }[] = []

    await act(async () => {
      left = await sharing().removeEach(people('Leo', 'Ana', 'Kim'), nothing)
    })
    assert.deepEqual(left, [])
    // Nothing but the removals: no call takes the computer from anyone.
    assert.deepEqual(calls, [
      'agentRemoveConversationParticipant leo',
      'agentRemoveConversationParticipant ana',
      'agentRemoveConversationParticipant kim',
    ])
    assert.deepEqual(titles(), ['Leo and Kim can still use Bryan’s Mac'])
    // Without an opener, the notice has no button.
    assert.equal(notices[0]?.action, undefined)
  } finally {
    await unmount()
  }
})

test('an Undo failing part way keeps the rest on the receipt, and tells of those removed', async () => {
  reset()
  const { sharing, unmount } = await mount()

  try {
    keeps.add('leo')
    failing.add('ana')
    let left: { id: string }[] = []

    await act(async () => {
      left = await sharing().removeEach(people('Leo', 'Ana', 'Kim'), () => errors.push('undo'))
    })
    assert.deepEqual(
      left.map((person) => person.id),
      ['ana', 'kim'],
    )
    assert.deepEqual(errors, ['undo'])
    assert.deepEqual(titles(), ['Leo can still use Bryan’s Mac'])
  } finally {
    await unmount()
  }
})
