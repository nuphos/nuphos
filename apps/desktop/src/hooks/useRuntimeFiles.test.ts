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
let transfer = async () => ({
  groupId: 'g',
  fileId: 'f',
  fileName: 'clip.mp4',
  size: 46_000_000,
  url: 'https://store/clip',
})
let linkedTransfer = async () => ({
  ...(await transfer()),
  origin: 'this-computer' as 'this-computer' | 'agent',
})
const tooLarge = () =>
  new Error(`__ATLAS_API_ERROR__${JSON.stringify({ message: 'big', code: 'file_too_large' })}`)

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
      atlasReadLinkedFile: () => {
        calls.push('linked-read')

        return read().then((file) => ({ ...file, origin: 'this-computer' }))
      },
      atlasTransferLinkedFile: () => {
        calls.push('linked-transfer')

        return linkedTransfer()
      },
      atlasTransferRuntimeFile: () => {
        calls.push('transfer')

        return transfer()
      },
      fileTransferDownloadOne: async () => {
        calls.push('download')

        return { saved: false }
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

function render(active = true, refreshKey = 0, filePath?: string) {
  cursor = 0
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Test harness runs the hook with mocked React scheduling.
  const value = useRuntimeFiles('team', 'session', active, refreshKey, filePath)

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
  transfer = async () => ({
    groupId: 'g',
    fileId: 'f',
    fileName: 'clip.mp4',
    size: 46_000_000,
    url: 'https://store/clip',
  })
  linkedTransfer = async () => ({ ...(await transfer()), origin: 'this-computer' })
}

for (const name of [
  'clip.mp4',
  'clip.MOV',
  'clip.webm',
  'sound.mp3',
  'sound.wav',
  'photo.png',
  'slides.pdf',
]) {
  test(`a linked ${name} uses local lookup and retains its actual source`, async () => {
    reset()
    read = async () => {
      throw tooLarge()
    }
    const fetched = mock.method(globalThis, 'fetch', async () => new Response('%PDF'))
    const path = `/outside-workspace/space and 中文/${name}`

    try {
      render(true, 0, path)
      await settle()
      const result = render(true, 0, path)

      assert.ok(result.media)
      assert.equal(result.source?.label, 'This computer')
      assert.equal(result.source?.local, true)
      assert.ok(calls.includes('linked-transfer'))
      assert.ok(!calls.includes('transfer'))
      // Refresh repeats the same local lookup; navigating the runtime does not.
      result.refresh()
      render(true, 0, path)
      await settle()
      assert.equal(calls.filter((call) => call === 'linked-transfer').length, 2)
      render(true, 0, path).openFile('another.mp4')
      render(true, 0, path)
      await settle()
      assert.ok(calls.includes('transfer'))
      assert.equal(render(true, 0, path).source?.local, undefined)
    } finally {
      cleanup?.()
      fetched.mock.restore()
    }
  })
}

test('a linked file absent on this computer keeps the runtime source', async () => {
  reset()
  linkedTransfer = async () => ({ ...(await transfer()), origin: 'agent' })
  render(true, 0, '/workspace/clip.mp4')
  await settle()
  assert.equal(render(true, 0, '/workspace/clip.mp4').source?.local, undefined)
  assert.equal(render(true, 0, '/workspace/clip.mp4').source?.label, 'Local')
})

test('leaving linked media while its transfer is pending cannot replace the new preview', async () => {
  reset()
  let finish!: (value: Awaited<ReturnType<typeof linkedTransfer>>) => void

  linkedTransfer = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const path = '/outside-workspace/clip.mp4'

  render(true, 0, path)
  await settle()
  render(true, 0, path).openFile('report.txt')
  render(true, 0, path)
  await settle()
  finish({ ...(await transfer()), origin: 'this-computer' })
  await settle()
  assert.equal(render(true, 0, path).media, undefined)
  assert.deepEqual(render(true, 0, path).preview, { text: 'hi' })
})

test('a large linked document downloads from the local lookup; played media reuses its transfer', async () => {
  reset()
  read = async () => {
    throw tooLarge()
  }
  const path = '/outside-workspace/report.txt'

  render(true, 0, path)
  await settle()
  assert.equal(render(true, 0, path).tooLarge, true)
  await render(true, 0, path).download()
  assert.deepEqual(calls, ['source', 'linked-read', 'linked-transfer', 'download'])
  reset()
  const clip = '/outside-workspace/clip.mp4'

  render(true, 0, clip)
  await settle()
  await render(true, 0, clip).download()
  assert.deepEqual(calls, ['source', 'linked-transfer', 'download'])
})

test('local linked media over the transfer limit retains the too-large state', async () => {
  reset()
  linkedTransfer = async () => {
    throw tooLarge()
  }
  const path = '/outside-workspace/huge.mp4'

  render(true, 0, path)
  await settle()
  assert.equal(render(true, 0, path).overLimit, true)
  assert.equal(render(true, 0, path).media, undefined)
  assert.ok(!calls.includes('transfer'))
})

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

test('a video plays from the transfer store without trying the inline read', async () => {
  reset()
  render()
  await settle()
  render().openFile('clip.mp4')
  render()
  await settle()
  assert.equal(render().media?.kind, 'video')
  assert.equal(render().media?.url, 'https://store/clip')
  assert.deepEqual(calls, ['source', 'list', 'transfer'])
})

test('an image too large to read inline is transferred; other large files offer download', async () => {
  reset()
  read = async () => {
    throw tooLarge()
  }
  render()
  await settle()
  render().openFile('photo.png')
  render()
  await settle()
  assert.equal(render().media?.kind, 'image')
  render().openFile('dump.bin')
  render()
  await settle()
  assert.equal(render().media, undefined)
  assert.equal(render().tooLarge, true)
  assert.deepEqual(calls, ['source', 'list', 'read', 'transfer', 'read'])
})

test('media over the transfer store limit says so instead of offering download', async () => {
  reset()
  transfer = async () => {
    throw tooLarge()
  }
  render()
  await settle()
  render().openFile('huge.mp4')
  render()
  await settle()
  assert.equal(render().overLimit, true)
  assert.equal(render().tooLarge, false)
})

test('a PDF that finishes after its preview was left releases its blob URL', async () => {
  reset()
  const revoked: string[] = []
  const revoke = mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url))
  const fetched = mock.method(globalThis, 'fetch', async () => new Response('%PDF'))
  let finish!: (value: Awaited<ReturnType<typeof transfer>>) => void

  transfer = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  render()
  await settle()
  render().openFile('slides.pdf')
  render()
  await settle()
  render().openFile('report.txt')
  render()
  await settle()
  finish({ groupId: 'g', fileId: 'f', fileName: 'slides.pdf', size: 1, url: 'https://store/pdf' })
  await settle()
  await settle()
  assert.equal(revoked.length, 1)
  assert.ok(revoked[0].startsWith('blob:'))
  assert.equal(render().media, undefined)
  assert.deepEqual(render().preview, { text: 'hi' })
  revoke.mock.restore()
  fetched.mock.restore()
})
