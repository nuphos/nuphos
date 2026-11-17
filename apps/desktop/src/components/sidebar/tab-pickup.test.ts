import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTabPickup } from './tab-pickup.ts'

const pointer = (type: string, clientX: number, clientY = 0) =>
  Object.assign(new Event(type), { clientX, clientY })

test('a click or a short wobble stays a click; a drag swallows the click that ends it', () => {
  const target = new EventTarget()
  const pickup = createTabPickup(3, () => target)
  let pickups = 0
  const press = (x: number) =>
    pickup.press({ clientX: x, clientY: 0 }, () => {
      pickups += 1
    })

  // A plain click.
  press(100)
  target.dispatchEvent(pointer('pointerup', 100))
  assert.equal(pickups, 0)
  assert.equal(pickup.consumeClick(), false, 'the click selects the tab')

  // A wobble under the threshold, diagonal included.
  press(100)
  target.dispatchEvent(pointer('pointermove', 102, 1))
  target.dispatchEvent(pointer('pointerup', 102, 1))
  assert.equal(pickups, 0)
  assert.equal(pickup.consumeClick(), false, 'a 2px wobble still selects the tab')

  // A real drag picks the tab up once, then the click after the drop is swallowed once.
  press(100)
  target.dispatchEvent(pointer('pointermove', 104))
  target.dispatchEvent(pointer('pointermove', 140))
  target.dispatchEvent(pointer('pointerup', 140))
  assert.equal(pickups, 1, 'later moves belong to the drag, not to another pickup')
  assert.equal(pickup.consumeClick(), true, 'dropping a tab does not select it')
  assert.equal(pickup.consumeClick(), false, 'only that one click is swallowed')

  // Once released, stray moves cannot pick anything up.
  target.dispatchEvent(pointer('pointermove', 200))
  assert.equal(pickups, 1)
})

test('a cancelled press and a new press each start clean', () => {
  const target = new EventTarget()
  const pickup = createTabPickup(3, () => target)
  let pickups = 0

  pickup.press({ clientX: 0, clientY: 0 }, () => {
    pickups += 1
  })
  pickup.cancel()
  target.dispatchEvent(pointer('pointermove', 50))
  assert.equal(pickups, 0, 'an unmounted tab stops listening')

  pickup.press({ clientX: 0, clientY: 0 }, () => {
    pickups += 1
  })
  target.dispatchEvent(pointer('pointermove', 10))
  target.dispatchEvent(pointer('pointerup', 10))
  pickup.press({ clientX: 0, clientY: 0 }, () => {
    pickups += 1
  })
  target.dispatchEvent(pointer('pointerup', 0))
  assert.equal(pickups, 1)
  assert.equal(pickup.consumeClick(), false, 'a new press forgets the previous drag')
})
