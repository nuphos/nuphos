import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

type Action = { label: string; onClick: () => void }
type Shown = { title: unknown; description: unknown; action?: Action; dedupe?: boolean }

const shown: Shown[] = []
const failures: { title: unknown; fallback?: string }[] = []
const patches: { sessionId: string; archived: boolean; teamId: string }[] = []
const log: string[] = []
let request: () => Promise<unknown>

mock.module('../api.ts', {
  namedExports: {
    api: {
      agentSetConversationArchived(sessionId: string, archived: boolean, teamId: string) {
        patches.push({ sessionId, archived, teamId })

        return request()
      },
    },
  },
})
mock.module('../components/ui/toast.ts', {
  namedExports: {
    toast: {
      success(title: unknown, description: unknown, opts?: { action?: Action; dedupe?: boolean }) {
        shown.push({ title, description, action: opts?.action, dedupe: opts?.dedupe })
      },
      apiError(title: unknown, _err: unknown, opts?: { fallback?: string }) {
        failures.push({ title, fallback: opts?.fallback })
      },
    },
  },
})
mock.module('./chatArchiveEvents.ts', {
  namedExports: {
    announceChatUnarchived(sessionId: string) {
      log.push(`announced ${sessionId}`)
    },
  },
})

const { offerArchiveUndo } = await import('./archiveUndo.ts')

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function reset() {
  shown.length = 0
  failures.length = 0
  patches.length = 0
  log.length = 0
}

test('the receipt names the chat and never merges with another archive', () => {
  reset()
  offerArchiveUndo({ sessionId: 'a', teamId: 'team', title: 'Deploy notes' })

  assert.equal(shown.length, 1)
  assert.equal(shown[0].title, 'Agent archived')
  assert.equal(shown[0].description, '"Deploy notes" is still available in the Agent history.')
  assert.equal(shown[0].action?.label, 'Undo')
  assert.equal(shown[0].dedupe, false)
})

test('undo restores the chat, then tells the other surfaces', async () => {
  reset()
  request = () => Promise.resolve({ ok: true, archived: false })
  offerArchiveUndo({
    sessionId: 'a',
    teamId: 'team',
    title: 'Deploy notes',
    onRestored: () => log.push('restored a'),
  })

  shown[0].action?.onClick()
  await settle()

  assert.deepEqual(patches, [{ sessionId: 'a', archived: false, teamId: 'team' }])
  assert.deepEqual(log, ['restored a', 'announced a'])
  assert.deepEqual(failures, [])
})

test('a second click while restoring sends one request', async () => {
  reset()
  request = () => Promise.resolve({ ok: true, archived: false })
  offerArchiveUndo({ sessionId: 'a', teamId: 'team', title: 'Deploy notes' })

  shown[0].action?.onClick()
  shown[0].action?.onClick()
  await settle()

  assert.equal(patches.length, 1)
})

test('a failed restore always shows an error and leaves the chat archived', async () => {
  reset()
  request = () => Promise.reject(new Error('offline'))
  offerArchiveUndo({
    sessionId: 'a',
    teamId: 'team',
    title: 'Deploy notes',
    onRestored: () => log.push('restored a'),
  })

  shown[0].action?.onClick()
  await settle()

  assert.deepEqual(log, [])
  assert.deepEqual(failures, [
    {
      title: 'Could not restore agent',
      fallback: 'The agent is still archived. Try again from the Agent history.',
    },
  ])
})

test('each archive in a row keeps its own undo', async () => {
  reset()
  request = () => Promise.resolve({ ok: true, archived: false })
  offerArchiveUndo({ sessionId: 'a', teamId: 'team', title: 'First' })
  offerArchiveUndo({ sessionId: 'b', teamId: 'team', title: 'Second' })

  shown[0].action?.onClick()
  await settle()

  assert.deepEqual(
    patches.map((patch) => patch.sessionId),
    ['a'],
  )
  assert.deepEqual(log, ['announced a'])
})
