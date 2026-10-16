import assert from 'node:assert/strict'
import test from 'node:test'

import { comboParts, comboText } from './platform.ts'

test('mod+shift+letter renders glyphs on mac and words elsewhere', () => {
  assert.deepEqual(comboParts('mod+shift+t', true), ['⌘', '⇧', 'T'])
  assert.deepEqual(comboParts('mod+shift+t', false), ['Ctrl', 'Shift', 'T'])
})

test('punctuation and digit keys pass through uppercased/verbatim', () => {
  assert.deepEqual(comboParts('mod+,', true), ['⌘', ','])
  assert.deepEqual(comboParts('mod+,', false), ['Ctrl', ','])
  assert.deepEqual(comboParts('mod+/', true), ['⌘', '/'])
  assert.deepEqual(comboParts('mod+1', true), ['⌘', '1'])
  assert.deepEqual(comboParts('mod+shift+[', true), ['⌘', '⇧', '['])
})

test('named keys map per platform', () => {
  assert.deepEqual(comboParts('enter', true), ['↵'])
  assert.deepEqual(comboParts('enter', false), ['Enter'])
  assert.deepEqual(comboParts('shift+enter', false), ['Shift', 'Enter'])
  assert.deepEqual(comboParts('esc', true), ['Esc'])
  assert.deepEqual(comboParts('tab', true), ['⇥'])
  assert.deepEqual(comboParts('up', false), ['↑'])
})

test('plus/minus tokens render as symbols without breaking the + separator', () => {
  assert.deepEqual(comboParts('mod+plus', true), ['⌘', '+'])
  assert.deepEqual(comboParts('mod+minus', false), ['Ctrl', '−'])
})

test('comboText puts mac modifiers in Apple order and joins words elsewhere', () => {
  assert.equal(comboText('mod+shift+a', true), '⇧⌘A')
  assert.equal(comboText('mod+alt+r', true), '⌥⌘R')
  assert.equal(comboText('ctrl+shift+m', true), '⌃⇧M')
  assert.equal(comboText('mod+shift+a', false), 'Ctrl+Shift+A')
  assert.equal(comboText('mod+,', true), '⌘,')
})
