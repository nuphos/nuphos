import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

let archiveWithThreads: typeof import('./archiveWithThreads.ts').archiveWithThreads
const restored: string[] = []
const toasts: { kind: string; title: string; detail?: string; undo?: () => void }[] = []

before(async () => {
  mock.module('../api.ts', {
    namedExports: {
      api: {
        agentSetConversationArchived: async (id: string) => {
          restored.push(id)
        },
      },
    },
  })
  mock.module('../components/ui/toast.ts', {
    namedExports: {
      toast: {
        success: (title: string, detail: string, options: { action: { onClick: () => void } }) =>
          toasts.push({ kind: 'success', title, detail, undo: options.action.onClick }),
        error: (title: string) => toasts.push({ kind: 'error', title }),
      },
    },
  })
  mock.module('./chatArchiveEvents.ts', { namedExports: { announceChatUnarchived: () => {} } })
  ;({ archiveWithThreads } = await import('./archiveWithThreads.ts'))
})

test('one receipt whose Undo restores the chat and every thread archived with it', async () => {
  toasts.length = 0
  restored.length = 0
  const ok = await archiveWithThreads({
    sessionId: 'p',
    threadIds: ['a', 'b', 'c'],
    title: 'Parent',
    teamId: 't',
    archiveOne: async (id) => id !== 'c',
  })

  assert.equal(ok, true)
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, 'Chat and 2 threads archived')
  assert.equal(toasts[0].detail, '1 of 3 threads could not be archived.')
  toasts[0].undo?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(restored.sort(), ['a', 'b', 'p'])
})

test('if the chat itself fails, no thread is touched', async () => {
  toasts.length = 0
  const touched: string[] = []
  const ok = await archiveWithThreads({
    sessionId: 'p',
    threadIds: ['a'],
    title: 'Parent',
    teamId: 't',
    archiveOne: async (id) => {
      touched.push(id)

      return false
    },
  })

  assert.equal(ok, false)
  assert.deepEqual(touched, ['p'])
  assert.deepEqual(
    toasts.map((t) => t.kind),
    ['error'],
  )
})
