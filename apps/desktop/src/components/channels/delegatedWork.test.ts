import assert from 'node:assert/strict'
import { test } from 'node:test'

import { delegatedRounds, firstSentence, taskSaid, taskStatus } from './delegatedWork.ts'

import type { AgentConversation } from '../../api/agent-types.ts'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

const task = (sessionId: string, at: number, fields = {}) =>
  ({
    sessionId,
    title: sessionId,
    firstMessage: 'Draft the release notes.',
    messageCount: 0,
    createdAt: new Date(at).toISOString(),
    lastActiveAt: '',
    ...fields,
  }) as AgentConversation

test('a chat whose Bot started no Task has no card', () => {
  assert.deepEqual(delegatedRounds([], [1000, 2000]), [])
})

test('each turn keeps the Tasks started in it, in the order they were started', () => {
  const rounds = delegatedRounds(
    [task('c', 2500), task('b', 1600), task('a', 1500), task('early', 500)],
    [2000, 1000],
  )

  assert.deepEqual(
    rounds.map((round) => round.tasks.map((item) => item.sessionId)),
    [['early'], ['a', 'b'], ['c']],
  )
  // A card sits after its turn's posts and before the next turn's first; the newest stays last.
  assert.deepEqual(
    rounds.map((round) => round.at),
    [999.5, 1999.5, Number.MAX_SAFE_INTEGER],
  )
  // A turn that started nothing has no card.
  assert.equal(delegatedRounds([task('c', 2500)], [1000, 2000]).length, 1)
})

test("a Task's state is its badge's: a question first, then its run", () => {
  const idle: RuntimeExecution = { state: 'idle', schemaVersion: 2 }
  const active: RuntimeExecution = { state: 'active', schemaVersion: 2, phase: 'running' }
  const asking = { inputRequests: [{ status: 'open', askedAt: '' }] } as AgentConversation

  assert.equal(taskStatus(asking, active), 'waiting')
  assert.equal(taskStatus({}, active), 'running')
  assert.equal(taskStatus({}, idle), 'done')
  assert.equal(taskStatus({}, { state: 'interrupted', schemaVersion: 2 }), 'stopped')
  assert.equal(taskStatus({}, undefined), 'done')
})

test('a Task says nothing while its newest message is still the prompt', () => {
  const prompt = 'Draft the **v2.4** release notes from the merged pull requests.'

  assert.equal(taskSaid({ firstMessage: prompt }), '')
  // The list previews the prompt as plain text.
  assert.equal(
    taskSaid({
      firstMessage: prompt,
      lastMessage: { text: 'Draft the v2.4 release notes from the merged pull requests.' },
    }),
    '',
  )
  assert.equal(
    taskSaid({ firstMessage: prompt, lastMessage: { text: 'Reading the merged pull requests' } }),
    'Reading the merged pull requests',
  )
})

test('a finished Task shows the first sentence of its last message', () => {
  assert.equal(
    firstSentence('The draft is in docs/v2.4.md: 14 changes. Two entries need a check.'),
    'The draft is in docs/v2.4.md: 14 changes.',
  )
  assert.equal(firstSentence('草稿已完成。還有兩項要確認'), '草稿已完成。')
  assert.equal(firstSentence('No full stop here'), 'No full stop here')
})
