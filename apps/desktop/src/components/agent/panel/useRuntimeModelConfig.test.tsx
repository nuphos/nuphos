import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

import type { ModelControl } from './ModelSelector'
import type { SessionConfigPick, SessionConfigState } from '../../../api/session-config-types'

type Read = { pick: SessionConfigPick; resolve: (state: SessionConfigState) => void }

/** Every read of the runtime's models, left open until the test answers it. */
const reads: Read[] = []

mock.module('../../../api', () => ({
  api: {
    atlasGetRuntimeModelConfig: (_team: string, _runtime: string, pick: SessionConfigPick) =>
      new Promise<SessionConfigState>((resolve) => reads.push({ pick, resolve })),
    // No local runtime to ask, so the picker is not read again behind the test's back.
    localRuntimeRefreshModels: () => Promise.reject(new Error('no local runtime')),
  },
}))

const dom = new Window()
const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { useRuntimeModelConfig } = await import('./useRuntimeModelConfig')
const { createRoot } = await import('react-dom/client')

const sonnet: SessionConfigState = {
  status: 'ready',
  options: [
    {
      id: 'model',
      name: 'Model',
      kind: 'model',
      currentValue: 'sonnet',
      options: [{ value: 'sonnet', name: 'Sonnet' }],
    },
  ],
}

const answer = (read: Read | undefined) =>
  act(async () => {
    read?.resolve(sonnet)
  })

function mount() {
  let control: ModelControl | undefined
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const Probe = ({ pick }: { pick: SessionConfigPick }) => {
    control = useRuntimeModelConfig('team', 'runtime', pick, mock())

    return null
  }
  const render = (pick: SessionConfigPick) => act(() => root.render(createElement(Probe, { pick })))
  const now = () => {
    if (!control) throw new Error('the picker has not rendered')

    return control
  }

  return { render, root, now }
}

test('opening the picker reads the list again without showing a save in flight', async () => {
  reads.length = 0
  const picker = mount()

  await picker.render({ model: 'sonnet' })
  await answer(reads[0])
  assert.equal(picker.now().saving, false)
  assert.ok(picker.now().data, 'the list is there to open on')

  await act(() => picker.now().setOpen(true))
  assert.equal(reads.length, 2, 'opening asks the runtime again')
  assert.equal(picker.now().saving, false, 'a read is not a save: no spinner, no disabled rows')
  assert.ok(picker.now().data, 'the last list stays while it is read again')

  await answer(reads[1])
  assert.equal(picker.now().saving, false)
  await act(() => picker.root.unmount())
})

test('a pick is a save until the runtime answers it', async () => {
  reads.length = 0
  const picker = mount()

  await picker.render({ model: 'sonnet' })
  await answer(reads[0])

  await picker.render({ model: 'sonnet', effort: 'high' })
  assert.deepEqual(reads[1]?.pick, { model: 'sonnet', effort: 'high' })
  assert.equal(picker.now().saving, true)

  await answer(reads[1])
  assert.equal(picker.now().saving, false)
  await act(() => picker.root.unmount())
})
