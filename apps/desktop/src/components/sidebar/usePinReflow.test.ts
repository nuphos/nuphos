import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { usePinReflow } from './usePinReflow.ts'

test('reordering keeps pin nodes and animates displacement instead of remounting', async () => {
  const dom = new Window()
  const values = {
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    getComputedStyle: () => ({ transform: 'none' }),
  }
  const original = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  const moves: unknown[] = []
  let canceled = 0
  let pageOffset = 0

  Object.defineProperty(dom.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0

      return { left: index * 72 + pageOffset, top: 0 }
    },
  })
  Object.defineProperty(dom.HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * 72 : 0
    },
  })
  Object.defineProperty(dom.HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get: () => 0,
  })
  Object.defineProperty(dom.HTMLElement.prototype, 'animate', {
    configurable: true,
    value: (frames: unknown) => {
      moves.push(frames)

      return {
        cancel: () => {
          canceled++
        },
      }
    },
  })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  function Fixture({ order }: { order: string[] }) {
    const [zone, setZone] = useState<HTMLDivElement | null>(null)

    usePinReflow(zone)

    return createElement(
      'div',
      { ref: setZone },
      order.map((key) => createElement('div', { key, 'data-pin-slot': key }, key)),
    )
  }
  try {
    await act(() => root.render(createElement(Fixture, { order: ['a', 'b'] })))
    const a = container.querySelector('[data-pin-slot="a"]')

    pageOffset = -248
    await act(() => root.render(createElement(Fixture, { order: ['a', 'b'] })))
    assert.equal(moves.length, 0, 'sliding the whole sidebar page must not trigger pin reflow')
    pageOffset = 0
    await act(() => root.render(createElement(Fixture, { order: ['a', 'b'] })))
    assert.equal(moves.length, 0, 'returning to Bots must not animate individual pins')
    await act(() => root.render(createElement(Fixture, { order: ['b', 'a'] })))
    assert.equal(container.querySelector('[data-pin-slot="a"]'), a)
    assert.equal(moves.length, 2)
    assert.deepEqual(moves[0], [
      { transform: 'translate(72px,0px)' },
      { transform: 'translate(0,0)' },
    ])
    await act(() => root.unmount())
    assert.equal(canceled, 2)
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
    await dom.happyDOM.close()
  }
})
