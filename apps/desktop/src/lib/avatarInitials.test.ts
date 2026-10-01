import assert from 'node:assert/strict'
import { test } from 'node:test'

import { initials, initialsFontSize } from './avatarInitials.ts'

test('a full-width name keeps only its first glyph', () => {
  assert.equal(initials('潮網科技研發部'), '潮')
  assert.equal(initials('潮網 科技'), '潮')
  assert.equal(initials('さくらインターネット'), 'さ')
  assert.equal(initials('카카오엔터프라이즈'), '카')
})

// A supplementary-plane ideograph is two UTF-16 units, so `[0]` used to hand
// back half of one — a lone surrogate renders as a replacement box.
test('supplementary-plane ideographs survive as whole code points', () => {
  for (const name of ['\u{20000}', '\u{20000} Team', '\u{20000}\u{20001}']) {
    const text = initials(name)

    assert.equal([...text].length, 1, `expected one glyph from ${name}, got ${text}`)
    assert.equal(text, '\u{20000}')
    assert.ok(initialsFontSize(text, 20) >= 10, 'measured as full-width')
  }
})

test('a proportional name keeps two letters', () => {
  assert.equal(initials('Acme Cloud'), 'AC')
  assert.equal(initials('acme'), 'AC')
  assert.equal(initials('Ökologie Werkstatt'), 'ÖW')
  assert.equal(initials('  '), '?')
})

// 'ß'.toUpperCase() is 'SS', which would smuggle a third glyph past the width
// model and render wider than the box it was measured for.
test('an expanding uppercase stays one glyph per slot', () => {
  assert.equal(initials('ßeta'), 'SE')
  assert.equal([...initials('ßeta ßeta')].length, 2)
})

// The bug this guards: a fixed 11px lived in the avatar for every box from the
// 20px switcher chip to the 56px settings tile, so a full-width glyph pair
// (22px) was clipped by `overflow-hidden` at the small end.
test('initials fit inside their box at every size in use', () => {
  const advance = (text: string) =>
    [...text].reduce((sum, ch) => sum + (/[\u1100-\uD7AF]/.test(ch) ? 1 : 0.62), 0)

  for (const name of ['潮網科技研發部', 'Acme Cloud', 'Zeabur', '   ']) {
    const text = initials(name)

    for (const box of [16, 18, 20, 22, 24, 28, 32, 56]) {
      const font = initialsFontSize(text, box)

      assert.ok(advance(text) * font <= box, `${text} at ${box}px box got ${font}px font`)
      assert.ok(font >= 8, `${text} at ${box}px box got ${font}px font`)
    }
  }
})

test('font size scales with the box instead of staying fixed', () => {
  assert.ok(initialsFontSize('潮', 56) > initialsFontSize('潮', 20))
  assert.equal(initialsFontSize('潮', 20), 10)
  assert.equal(initialsFontSize('AC', 20), 10)
})

test('a mixed-script pair is measured glyph by glyph', () => {
  assert.equal(initials('A潮'), 'A潮')
  const font = initialsFontSize('A潮', 24)

  assert.ok(1.62 * font <= 24, `got ${font}px font`)
})
