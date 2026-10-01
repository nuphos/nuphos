import assert from 'node:assert/strict'
import test from 'node:test'

import { cssTripletToHex, landingBurstShots } from './confetti.ts'

test('converts an index.css color triplet to hex', () => {
  assert.equal(cssTripletToHex('116, 93, 243'), '#745df3')
  assert.equal(cssTripletToHex('0, 0, 0'), '#000000')
  assert.equal(cssTripletToHex('255, 255, 255'), '#ffffff')
})

test('tolerates the whitespace variants getComputedStyle can return', () => {
  assert.equal(cssTripletToHex('116,93,243'), '#745df3')
  assert.equal(cssTripletToHex('  116 , 93 , 243  '), '#745df3')
})

test('rejects anything that is not a clean R, G, B triplet', () => {
  assert.equal(cssTripletToHex(''), null)
  assert.equal(cssTripletToHex('116, 93'), null)
  assert.equal(cssTripletToHex('116, 93, 243, 0.5'), null)
  assert.equal(cssTripletToHex('300, 0, 0'), null)
  assert.equal(cssTripletToHex('-1, 0, 0'), null)
  assert.equal(cssTripletToHex('12.5, 0, 0'), null)
  assert.equal(cssTripletToHex('#745df3'), null)
  assert.equal(cssTripletToHex('rgb(116, 93, 243)'), null)
})

test('fires from both bottom corners, aiming up and inward', () => {
  const shots = landingBurstShots()

  assert.ok(shots.length > 0)
  for (const shot of shots) {
    assert.ok(shot.particleCount > 0)
    assert.ok(shot.spread > 0)
    assert.ok(shot.startVelocity > 0)
    assert.ok(shot.ticks > 0)
    assert.ok(shot.origin.x >= 0 && shot.origin.x <= 1)
    assert.ok(shot.origin.y >= 0.9, `launches from the bottom edge: ${shot.origin.y}`)
    if (shot.origin.x < 0.5) {
      assert.ok(shot.angle > 0 && shot.angle < 90, `left cannon aims up-right: ${shot.angle}`)
    } else {
      assert.ok(shot.angle > 90 && shot.angle < 180, `right cannon aims up-left: ${shot.angle}`)
    }
  }
})

test('the two cannons mirror each other', () => {
  const shots = landingBurstShots()
  const left = shots.filter((s) => s.origin.x < 0.5)
  const right = shots.filter((s) => s.origin.x >= 0.5)

  assert.equal(left.length, right.length)
  for (const [i, l] of left.entries()) {
    const r = right[i]

    assert.equal(l.angle + r.angle, 180)
    assert.ok(Math.abs(l.origin.x - (1 - r.origin.x)) < 1e-9, 'origins mirror across center')
    assert.equal(l.particleCount, r.particleCount)
    assert.equal(l.spread, r.spread)
    assert.equal(l.startVelocity, r.startVelocity)
  }
})

test('the total particle count stays celebration-sized, not perf-hazard-sized', () => {
  const total = landingBurstShots().reduce((sum, s) => sum + s.particleCount, 0)

  assert.ok(total >= 100, `enough to read as a celebration: ${total}`)
  assert.ok(total <= 400, `not enough to hitch the landing frame: ${total}`)
})
