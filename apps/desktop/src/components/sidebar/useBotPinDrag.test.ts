import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { useBotPinDrag } from './useBotPinDrag.ts'

import type { Item } from './types'

test('3px preview, outside cancellation, additional slot and drag back to unpin', async () => {
  const dom = new Window()
  const keys = ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']
  const original = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  )

  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const bots: Item[] = ['a', 'b'].map((key) => ({ key, label: key, enabled: true, bot: true }))
  const mutations: string[] = []

  function Fixture() {
    const [pins, setPins] = useState<string[]>([])
    const drag = useBotPinDrag(
      bots,
      (bot) => pins.includes(bot.key),
      (bot) => {
        mutations.push(bot.key)
        setPins((previous) =>
          previous.includes(bot.key)
            ? previous.filter((key) => key !== bot.key)
            : [...previous, bot.key],
        )
      },
    )

    return createElement(
      'div',
      {
        onPointerDownCapture: drag.onPointerDownCapture,
        onDragStartCapture: drag.onDragStartCapture,
        onClickCapture: drag.onClickCapture,
      },
      pins.length || drag.dragged
        ? createElement(
            'div',
            { 'data-bot-pin-zone': true },
            ...pins.map((key) => createElement('button', { key, 'data-bot-pin-key': key }, key)),
            drag.dragged && !pins.includes(drag.dragged)
              ? createElement('span', { 'data-slot': true }, 'slot')
              : null,
          )
        : null,
      drag.dragged ? createElement('div', { ref: drag.ghost, 'data-ghost': true }) : null,
      createElement(
        'div',
        { 'data-bot-pin-list': true },
        ...bots
          .filter((bot) => !pins.includes(bot.key))
          .map((bot) =>
            createElement('button', { key: bot.key, 'data-bot-pin-key': bot.key }, bot.key),
          ),
      ),
    )
  }
  const query = (selector: string) => dom.document.querySelector(selector)!
  const event = (target: ReturnType<typeof query> | Window, type: string, x: number) =>
    target.dispatchEvent(
      new dom.PointerEvent(type, {
        bubbles: true,
        button: 0,
        // macOS native drags can report buttons=0 on pointermove after a valid down.
        buttons: type === 'pointerdown' ? 1 : 0,
        clientX: x,
        clientY: 100,
      }),
    )
  let hit: ReturnType<typeof query> = dom.document.body

  dom.document.elementFromPoint = () => hit
  const begin = async (key: string) => {
    await act(() => {
      event(query(`[data-bot-pin-key="${key}"]`), 'pointerdown', 100)
    })
    await act(() => {
      event(dom, 'pointermove', 102)
    })
    assert.equal(
      dom.document.querySelector('[data-slot]'),
      null,
      'jitter must not open a drop slot',
    )
    await act(() => {
      event(dom, 'pointermove', 104)
    })
  }
  const release = async (selector: string) => {
    hit = query(selector)
    await act(() => {
      event(dom, 'pointerup', 104)
    })
  }

  try {
    await act(() => root.render(createElement(Fixture)))
    assert.equal(dom.document.querySelector('[data-bot-pin-zone]'), null)
    const source = query('[data-bot-pin-key="a"]')

    source.getBoundingClientRect = () => ({
      x: 80,
      y: 60,
      left: 80,
      top: 60,
      right: 180,
      bottom: 160,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    })
    dom.HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
        toJSON: () => ({}),
      }
    }
    await begin('a')
    assert.equal(
      query('[data-ghost]').getAttribute('style'),
      'transform: translate3d(84px,60px,0);',
      'the preview keeps the original grab point',
    )
    await act(() => {
      event(dom, 'pointermove', 114)
    })
    assert.equal(
      query('[data-ghost]').getAttribute('style'),
      'transform: translate3d(94px,60px,0);',
      'the grab point follows subsequent movement',
    )
    assert.equal(
      query('[data-bot-pin-list] [data-bot-pin-key="a"]').getAttribute('style'),
      'opacity: 0.4;',
    )
    assert.ok(dom.document.querySelector('[data-slot]'))
    await release('body')
    assert.deepEqual(mutations, [], 'dropping outside leaves preferences untouched')
    assert.ok(!query('[data-bot-pin-list] [data-bot-pin-key="a"]').getAttribute('style'))
    assert.equal(dom.document.querySelector('[data-bot-pin-zone]'), null)
    await begin('a')
    await release('[data-bot-pin-zone]')
    assert.ok(query('[data-bot-pin-zone] [data-bot-pin-key="a"]'))
    assert.equal(dom.document.querySelector('[data-bot-pin-list] [data-bot-pin-key="a"]'), null)
    await begin('b')
    assert.ok(query('[data-bot-pin-zone] [data-bot-pin-key="a"]'))
    assert.ok(query('[data-slot]'), 'an existing pin keeps its place while a new slot opens')
    await release('[data-bot-pin-zone]')
    assert.equal(query('[data-bot-pin-zone]').querySelectorAll('button').length, 2)
    await begin('a')
    await release('[data-bot-pin-list]')
    assert.ok(query('[data-bot-pin-list] [data-bot-pin-key="a"]'))
    assert.equal(dom.document.querySelector('[data-bot-pin-zone] [data-bot-pin-key="a"]'), null)
    assert.deepEqual(mutations, ['a', 'b', 'a'], 'each completed drop changes preferences once')
    await act(() => {
      event(query('[data-bot-pin-list] [data-bot-pin-key="a"]'), 'pointerdown', 100)
      event(dom, 'pointermove', 104)
      hit = query('[data-bot-pin-zone]')
      assert.ok(
        hit.querySelector('[data-slot]'),
        'the drop target must exist before the same-frame pointerup',
      )
      const takeover = new dom.DragEvent('dragstart', { bubbles: true, cancelable: true })

      query('[data-bot-pin-list] [data-bot-pin-key="a"]').dispatchEvent(takeover)
      assert.equal(
        takeover.defaultPrevented,
        true,
        'native takeover must not cancel the active pin pointer',
      )
      const shelf = query('[data-bot-pin-zone]')

      shelf.getBoundingClientRect = () => ({
        x: 0,
        y: 80,
        left: 0,
        top: 80,
        right: 200,
        bottom: 160,
        width: 200,
        height: 80,
        toJSON: () => ({}),
      })
      hit = dom.document.body // CSS is still expanding; visible hit-testing misses the shelf.

      event(dom, 'pointerup', 104)
    })
    assert.ok(query('[data-bot-pin-zone] [data-bot-pin-key="a"]'))
    assert.deepEqual(mutations, ['a', 'b', 'a', 'a'])
  } finally {
    await act(() => root.unmount())
    await dom.happyDOM.close()
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
