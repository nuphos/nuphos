import assert from 'node:assert/strict'
import { test } from 'node:test'

import { copyLinkWithFeedback } from './copyLink.ts'

test('copyLinkWithFeedback reports success only after the clipboard write completes', async () => {
  const events: string[] = []
  let resolveWrite!: () => void
  const writeCompleted = new Promise<void>((resolve) => {
    resolveWrite = resolve
  })

  const copying = copyLinkWithFeedback(
    'https://nuphos.ai/teams/team-1/monitoring/grafana/instance/alert-rule/rule-1',
    (value) => {
      events.push(`write:${value}`)

      return writeCompleted
    },
    {
      onSuccess: () => events.push('success'),
      onError: () => events.push('error'),
    },
  )

  assert.deepEqual(events, [
    'write:https://nuphos.ai/teams/team-1/monitoring/grafana/instance/alert-rule/rule-1',
  ])
  resolveWrite()
  const copied = await copying

  assert.equal(copied, true)
  assert.deepEqual(events, [
    'write:https://nuphos.ai/teams/team-1/monitoring/grafana/instance/alert-rule/rule-1',
    'success',
  ])
})

test('copyLinkWithFeedback reports failure without a false success', async () => {
  const events: string[] = []

  const copied = await copyLinkWithFeedback(
    'https://nuphos.ai/teams/team-1/monitoring/gcp/binding/alert-policy/policy-1',
    async () => {
      throw new Error('clipboard blocked')
    },
    {
      onSuccess: () => events.push('success'),
      onError: () => events.push('error'),
    },
  )

  assert.equal(copied, false)
  assert.deepEqual(events, ['error'])
})

test('copyLinkWithFeedback ignores an empty link', async () => {
  const events: string[] = []

  const copied = await copyLinkWithFeedback('', async () => events.push('write'), {
    onSuccess: () => events.push('success'),
    onError: () => events.push('error'),
  })

  assert.equal(copied, false)
  assert.deepEqual(events, [])
})

test('copyLinkWithFeedback does not report clipboard failure when success feedback throws', async () => {
  const events: string[] = []

  await assert.rejects(
    copyLinkWithFeedback(
      'https://nuphos.ai/teams/team-1/monitoring/betterstack/binding/monitor/monitor-1',
      async () => {
        events.push('write')
      },
      {
        onSuccess: () => {
          events.push('success')
          throw new Error('toast failed')
        },
        onError: () => events.push('error'),
      },
    ),
    /toast failed/,
  )

  assert.deepEqual(events, ['write', 'success'])
})
