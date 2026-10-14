import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const calls: { sessionId: string; archived: boolean; teamId: string }[] = []
let request: () => Promise<{ ok: boolean; archived: boolean }>

mock.module('../api.ts', {
  namedExports: {
    api: {
      agentSetConversationArchived(sessionId: string, archived: boolean, teamId: string) {
        calls.push({ sessionId, archived, teamId })

        return request()
      },
    },
  },
})

const { archiveChat } = await import('./archiveChat.ts')

test('sidebar and page share one in-flight archive, and a later request is allowed', async () => {
  calls.length = 0
  let complete!: (value: { ok: boolean; archived: boolean }) => void

  request = () =>
    new Promise((resolve) => {
      complete = resolve
    })
  const sidebar = archiveChat('session', 'team')
  const page = archiveChat('session', 'team')

  assert.equal(sidebar, page)
  assert.deepEqual(calls, [{ sessionId: 'session', archived: true, teamId: 'team' }])
  complete({ ok: true, archived: true })
  await Promise.all([sidebar, page])
  request = () => Promise.resolve({ ok: true, archived: true })
  await archiveChat('session', 'team')
  assert.equal(calls.length, 2)
})

test('a failed archive can be retried without a stuck in-flight guard', async () => {
  calls.length = 0
  const error = new Error('Archive failed')

  request = () => Promise.reject(error)
  await assert.rejects(archiveChat('retry', 'team'), (caught) => caught === error)
  request = () => Promise.resolve({ ok: true, archived: true })
  await archiveChat('retry', 'team')
  assert.equal(calls.length, 2)
})

test('in-flight archives are isolated by team and session', async () => {
  calls.length = 0
  request = () => Promise.resolve({ ok: true, archived: true })
  await Promise.all([
    archiveChat('same-session', 'team-a'),
    archiveChat('same-session', 'team-b'),
    archiveChat('other-session', 'team-a'),
  ])
  assert.equal(calls.length, 3)
})
