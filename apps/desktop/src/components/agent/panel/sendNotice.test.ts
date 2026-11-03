import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sendNoticeFor } from './sendNotice.ts'

import type { Tab } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

const local = 'local_owner_mac'

function notice(tab: Partial<Tab>, catalog: string[] = [], online = true) {
  const started: string[] = []
  const result = sendNoticeFor(
    { sessionId: 's', runtimeId: local, sendBlocked: 'local_runtime_owner_only', ...tab } as Tab,
    catalog.map((id) => ({ id, status: 'active', local: { online } }) as RuntimeInstance),
    (id) => started.push(id),
  )

  return { result, started }
}

test('a teammate on the owner’s computer is told why before sending', () => {
  const { result } = notice({})

  assert.match(result?.label ?? '', /only they can send/)
  // Without use of that computer there is nothing else to offer.
  assert.equal(result?.action, undefined)
})

test('an offline computer offers no chat of their own, which could not start there', () => {
  assert.equal(notice({}, [local], false).result?.action, undefined)
})

test('a teammate who may use the computer can start their own chat on it', () => {
  const { result, started } = notice({}, [local])

  result?.action?.onSelect()
  assert.deepEqual(started, [local])
})

test('no notice once it is off the computer, for a viewer, or when the server allows the send', () => {
  assert.equal(notice({ runtimeId: 'team-runtime' }).result, undefined)
  assert.equal(notice({ readOnly: true }).result, undefined)
  assert.equal(notice({ sendBlocked: undefined }).result, undefined)
})
