import assert from 'node:assert/strict'
import { test } from 'node:test'

import { playTarget } from './playTarget.ts'

import type { DesignFrame, DesignLink } from '../schema.ts'

const frame = (id: string, title = id): DesignFrame => ({
  id,
  type: 'frame',
  title,
  x: 0,
  y: 0,
  width: 390,
  height: 844,
  html: '',
})
const frames = [frame('detail'), frame('confirm', '4 預約確認'), frame('full')]
const link = (target: string, label?: string): DesignLink => ({
  id: target,
  source: 'detail',
  target,
  label,
})
const click = (text: string, extra: Partial<Parameters<typeof playTarget>[0]> = {}) => ({
  goto: null,
  text,
  clickable: true,
  declared: false,
  ...extra,
})

test('a data-goto names the screen by id or by title', () => {
  assert.equal(playTarget(click('', { goto: 'full' }), [], frames), 'full')
  assert.equal(playTarget(click('', { goto: '4 預約確認' }), [], frames), 'confirm')
  assert.equal(playTarget(click('', { goto: 'nowhere' }), [], frames), null)
})

test('a button follows the link whose label names it', () => {
  const outgoing = [link('confirm', '點立即預約'), link('full', '剩餘名額為 0 時')]

  assert.equal(playTarget(click('立即預約'), outgoing, frames), 'confirm')
  assert.equal(playTarget(click('Tap 立即 預約'), outgoing, frames), 'confirm')
  assert.equal(playTarget(click('收藏'), outgoing, frames), null)
})

test('a single way out is taken from any click, even on a plain box', () => {
  const outgoing = [link('confirm')]

  assert.equal(playTarget(click('Anything'), outgoing, frames), 'confirm')
  assert.equal(playTarget(click('查看 →', { clickable: false }), outgoing, frames), 'confirm')
})

test('a plain box names a link only by short text, not by everything inside it', () => {
  const outgoing = [link('confirm', '點立即預約'), link('full', '名額已滿')]
  const card = '力量訓練 Power Lift 教練 Ryan Wu 剩餘名額 4 / 12 立即預約 NT$ 450'

  assert.equal(playTarget(click('立即預約', { clickable: false }), outgoing, frames), 'confirm')
  assert.equal(playTarget(click(card, { clickable: false }), outgoing, frames), null)
})

test('a page that marks its hotspots is not second-guessed', () => {
  const outgoing = [link('confirm', '點立即預約')]

  assert.equal(playTarget(click('立即預約', { declared: true }), outgoing, frames), null)
})
