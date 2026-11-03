import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sendNoticeFor } from './sendNotice.ts'

import type { Tab } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

const ownersComputer = 'local_owner_mac'
const timsComputer = 'local_tim_laptop'

function agent(id: string, online = true) {
  return { id, label: id, status: 'active', local: { online } } as RuntimeInstance
}

function notice(tab: Partial<Tab>, catalog: RuntimeInstance[] = []) {
  const calls: string[] = []
  const result = sendNoticeFor(
    {
      sessionId: 's',
      runtimeId: ownersComputer,
      sendBlocked: 'local_runtime_owner_only',
      ...tab,
    } as Tab,
    catalog,
    (id) => calls.push(`chat ${id}`),
    () => calls.push('setup'),
  )

  result?.action?.onSelect()

  return { result, calls }
}

test('a new teammate with no agent of their own is offered setup, never a dead end', () => {
  const { result, calls } = notice({})

  assert.match(result?.label ?? '', /only they can send/)
  assert.equal(result?.action?.label, 'Set up your agent')
  assert.deepEqual(calls, ['setup'])
})

test('a teammate who may use the owner’s computer starts their own chat there', () => {
  const { result, calls } = notice({}, [agent(timsComputer), agent(ownersComputer)])

  assert.equal(result?.action?.label, 'Start your own chat on this computer')
  assert.deepEqual(calls, [`chat ${ownersComputer}`])
})

test('otherwise their own usable agent; an offline one counts as none', () => {
  assert.deepEqual(notice({}, [agent(ownersComputer, false), agent(timsComputer)]).calls, [
    `chat ${timsComputer}`,
  ])
  assert.deepEqual(notice({}, [agent(timsComputer, false)]).calls, ['setup'])
})

test('no notice once it is off the computer, for a viewer, or when the server allows the send', () => {
  assert.equal(notice({ runtimeId: 'team-runtime' }).result, undefined)
  assert.equal(notice({ readOnly: true }).result, undefined)
  assert.equal(notice({ sendBlocked: undefined }).result, undefined)
})
