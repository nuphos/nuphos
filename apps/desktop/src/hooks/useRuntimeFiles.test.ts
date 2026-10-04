import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const slots: unknown[] = []
let cursor = 0
let dependencies: unknown[] | undefined
let cleanup: (() => void) | undefined
let effect: (() => (() => void) | undefined) | undefined
let calls: string[] = []
let resolveConversation = async () => ({ runtimeId: 'runtime', runtimeLabel: 'Local' })
let list = async () => ({ entries: [], truncated: false })
let read = async () => ({ name: 'report.txt', data: 'aGk=', size: 2 })

mock.module('../api.ts', {
  namedExports: {
    api: {
      agentGetConversation: () => {
        calls.push('source')

        return resolveConversation()
      },
      atlasListRuntimeFiles: () => {
        calls.push('list')

        return list()
      },
      atlasReadRuntimeFile: () => {
        calls.push('read')

        return read()
      },
    },
  },
})
mock.module('../components/ui/toast.ts', { namedExports: { toast: { error() {}, apiError() {} } } })
mock.module('react', {
  namedExports: {
    useRef: (initial: unknown) => {
      const index = cursor++

      slots[index] ??= { current: initial }

      return slots[index]
    },
    useState: (initial: unknown) => {
      const index = cursor++

      if (!(index in slots)) slots[index] = initial

      return [
        slots[index],
        (value: unknown) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        },
      ]
    },
    useEffect: (next: () => (() => void) | undefined, deps: unknown[]) => {
      if (dependencies && deps.every((value, index) => Object.is(value, dependencies![index])))
        return
      cleanup?.()
      dependencies = deps
      effect = next
    },
  },
})
const { useRuntimeFiles } = await import('./useRuntimeFiles.ts')
const settle = () => new Promise((resolve) => setImmediate(resolve))

function render(active = true, refreshKey = 0) {
  cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness runs the hook with mocked React scheduling.
  const value = useRuntimeFiles('team', 'session', active, refreshKey)

  if (effect) {
    const next = effect

    effect = undefined
    cleanup = next()
  }

  return value
}
function reset() {
  cleanup?.()
  cleanup = undefined
  effect = undefined
  dependencies = undefined
  slots.length = 0
  calls = []
  resolveConversation = async () => ({ runtimeId: 'runtime', runtimeLabel: 'Local' })
  list = async () => ({ entries: [], truncated: false })
  read = async () => ({ name: 'report.txt', data: 'aGk=', size: 2 })
}

test('refresh during preview reloads the visible file and ignores the older response', async () => {
  reset()
  render()
  await settle()
  let finishOld!: (value: { name: string; data: string; size: number }) => void

  read = () =>
    new Promise((resolve) => {
      finishOld = resolve
    })
  render().openFile('report.txt')
  render()
  await settle()
  read = async () => ({ name: 'report.txt', data: 'bmV3', size: 3 })
  render(true, 1)
  await settle()
  assert.deepEqual(render(true, 1).preview, { text: 'new' })
  finishOld({ name: 'report.txt', data: 'b2xk', size: 3 })
  await settle()
  assert.deepEqual(render(true, 1).preview, { text: 'new' })
  assert.equal(render(true, 1).loading, false)
  assert.deepEqual(calls, ['source', 'list', 'read', 'read'])
})

test('failed source lookup and missing runtime can retry without remounting', async () => {
  reset()
  resolveConversation = async () => {
    throw new Error('offline')
  }
  render()
  await settle()
  assert.equal(render().loading, false)
  resolveConversation = async () => ({ runtimeId: '', runtimeLabel: '' })
  render().refresh()
  render()
  await settle()
  assert.equal(render().source, null)
  resolveConversation = async () => ({ runtimeId: 'runtime', runtimeLabel: 'Local' })
  render(false)
  render(true)
  await settle()
  assert.equal(render().source?.runtimeId, 'runtime')
  assert.deepEqual(calls, ['source', 'source', 'source', 'list'])
})

test('failed root listing can refresh or retry on tab activation', async () => {
  reset()
  list = async () => {
    throw new Error('offline')
  }
  render()
  await settle()
  assert.equal(render().directory, null)
  render().refresh()
  render()
  await settle()
  list = async () => ({ entries: [], truncated: false })
  render(false)
  render(true)
  await settle()
  assert.deepEqual(render().directory, { entries: [], truncated: false })
  assert.deepEqual(calls, ['source', 'list', 'list', 'list'])
})
