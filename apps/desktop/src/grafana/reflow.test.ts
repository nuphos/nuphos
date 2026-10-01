import assert from 'node:assert/strict'
import { test } from 'node:test'

import { columnsForWidth, reflowBlock } from './reflow.ts'

import type { PlacedPanel } from './layout.ts'
import type { Panel } from './types.ts'

function placed(id: number, x: number, y: number, w: number, h: number): PlacedPanel {
  const panel: Panel = { id, type: 'stat', title: '', gridPos: { x, y, w, h }, targets: [] }

  return { panel, pos: { x, y, w, h } }
}

const BLOCK = {
  panels: [
    placed(1, 0, 0, 24, 3),
    placed(2, 0, 3, 6, 4),
    placed(3, 6, 3, 6, 4),
    placed(4, 12, 3, 6, 4),
    placed(5, 18, 3, 6, 4),
    placed(6, 0, 7, 12, 8),
    placed(7, 12, 7, 12, 8),
  ],
  heightRows: 15,
}

test('columnsForWidth keeps the full grid on wide panes', () => {
  assert.equal(columnsForWidth(1200), 24)
  assert.equal(columnsForWidth(0), 24)
  assert.equal(columnsForWidth(700), 2)
  assert.equal(columnsForWidth(400), 1)
})

test('reflowBlock returns the block untouched at full width', () => {
  assert.equal(reflowBlock(BLOCK, 24), BLOCK)
})

test('reflowBlock stacks every panel full width in reading order at one column', () => {
  const out = reflowBlock(BLOCK, 1)

  assert.deepEqual(
    out.panels.map((p) => [p.panel.id, p.pos.x, p.pos.y, p.pos.w, p.pos.h]),
    [
      [1, 0, 0, 24, 3],
      [2, 0, 3, 24, 4],
      [3, 0, 7, 24, 4],
      [4, 0, 11, 24, 4],
      [5, 0, 15, 24, 4],
      [6, 0, 19, 24, 8],
      [7, 0, 27, 24, 8],
    ],
  )
  assert.equal(out.heightRows, 35)
})

test('reflowBlock packs two per row at two columns and keeps wide panels full', () => {
  const out = reflowBlock(BLOCK, 2)

  assert.deepEqual(
    out.panels.map((p) => [p.panel.id, p.pos.x, p.pos.y, p.pos.w]),
    [
      [1, 0, 0, 24],
      [2, 0, 3, 12],
      [3, 12, 3, 12],
      [4, 0, 7, 12],
      [5, 12, 7, 12],
      [6, 0, 11, 12],
      [7, 12, 11, 12],
    ],
  )
  assert.equal(out.heightRows, 19)
})
