import assert from 'node:assert/strict'
import { test } from 'node:test'

import { viewOnlyNoticeFor } from './viewOnlyNotice.ts'

import type { Tab } from './model.ts'
import type { RuntimeInstance } from '../../../types/runtime.ts'

const ownersComputer = 'local_owner_mac'
const timsComputer = 'local_tim_laptop'

function agent(id: string, online = true) {
  return { id, label: id, status: 'active', local: { online } } as RuntimeInstance
}

function notice(tab: Partial<Tab>, catalog: RuntimeInstance[] = [], admin = false) {
  const calls: string[] = []
  const result = viewOnlyNoticeFor(
    { sessionId: 's', runtimeId: ownersComputer, readOnly: true, foreign: true, ...tab } as Tab,
    catalog,
    (id) => calls.push(`chat ${id}`),
    () => calls.push('setup'),
    admin ? () => calls.push('cloud') : undefined,
  )

  result?.action.onSelect()

  return { result, calls }
}

test('a new teammate with nothing to run on is offered setup, never a dead end', () => {
  const { result, calls } = notice({})

  assert.equal(result?.action.label, 'Set up your agent')
  assert.deepEqual(calls, ['setup'])
  assert.equal(result?.secondary, undefined)
})

test('an admin may take a cloud runtime instead of setting one up here', () => {
  assert.equal(notice({}, [], true).result?.secondary?.label, 'Use a cloud runtime instead')
  assert.equal(notice({}, [agent(timsComputer)], true).result?.secondary, undefined)
})

test('a viewer who may use that computer starts their own chat there', () => {
  const { result, calls } = notice({}, [agent(timsComputer), agent(ownersComputer)])

  assert.equal(result?.action.label, 'Start your own chat on this computer')
  assert.deepEqual(calls, [`chat ${ownersComputer}`])
})

test('otherwise on a usable agent of their own; an offline one counts as none', () => {
  assert.deepEqual(notice({}, [agent(ownersComputer, false), agent(timsComputer)]).calls, [
    `chat ${timsComputer}`,
  ])
  assert.deepEqual(notice({}, [agent(timsComputer, false)]).calls, ['setup'])
})

test('nothing for the owner, someone who can reply, a Slack thread, an audit open or a team agent', () => {
  assert.equal(notice({ foreign: undefined }).result, undefined)
  assert.equal(notice({ readOnly: false }).result, undefined)
  assert.equal(notice({ slackThread: { url: 'x' } as Tab['slackThread'] }).result, undefined)
  assert.equal(notice({ auditForcedReadOnly: true }).result, undefined)
  assert.equal(notice({ runtimeId: 'managed-runtime' }).result, undefined)
})
