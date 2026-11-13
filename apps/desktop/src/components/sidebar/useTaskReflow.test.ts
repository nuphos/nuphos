import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'

import { useTaskReflow } from './useTaskReflow.ts'

test('task motion survives status renders and retargets from its visible position', async () => {
  const dom = new Window()
  let shift = 0
  let pageTop = 0
  let reduced = false
  const moves: { frames: Keyframe[]; canceled: boolean }[] = []
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: () => ({ transform: `matrix(1,0,0,1,0,${shift})` }),
    DOMMatrixReadOnly: class {
      m42 = shift
    },
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  dom.matchMedia = (() => ({ matches: reduced })) as typeof dom.matchMedia
  Object.defineProperty(dom.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0

      return { top: pageTop + (this.dataset.taskReflowKey ? index * 40 + shift : 0) }
    },
  })
  Object.defineProperty(dom.HTMLElement.prototype, 'animate', {
    configurable: true,
    value: (frames: Keyframe[]) => {
      const move = { frames, canceled: false }

      moves.push(move)

      return {
        cancel: () => {
          move.canceled = true
        },
      }
    },
  })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  function Fixture({ order }: { order: string[] }) {
    const ref = useRef<HTMLDivElement>(null)

    useTaskReflow(ref)

    return createElement(
      'div',
      { ref },
      order.map((key) => createElement('div', { key, 'data-task-reflow-key': key }, key)),
    )
  }
  const render = (order: string[]) => act(() => root.render(createElement(Fixture, { order })))

  try {
    await render(['a', 'b'])
    assert.equal(moves.length, 0, 'initial hydration must not animate')
    const a = container.querySelector('[data-task-reflow-key="a"]')

    await render(['b', 'a'])
    assert.equal(moves.length, 2)
    assert.equal(container.querySelector('[data-task-reflow-key="a"]'), a)
    shift = -20
    await render(['b', 'a'])
    assert.equal(moves.length, 2, 'a status render must preserve the running Animation')
    assert.equal(moves[0].canceled, false)
    assert.equal(moves[1].canceled, false)
    pageTop = 100
    await render(['b', 'a'])
    assert.equal(moves.length, 2, 'moving the entire list must not move its individual rows')
    await render(['a', 'b'])
    assert.equal(moves.length, 4)
    assert.deepEqual(
      moves[2].frames[0],
      { transform: 'translateY(20px)' },
      'retarget from the visible position',
    )
    assert.equal(moves[1].canceled, true)
    reduced = true
    shift = 0
    await render(['a', 'b'])
    assert.equal(moves[3].canceled, true, 'reduced motion cancels in-flight motion')
    await render(['b', 'a'])
    assert.equal(moves.length, 4)
    await act(() => root.unmount())
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    await dom.happyDOM.close()
  }
})
