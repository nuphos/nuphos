import assert from 'node:assert/strict'
import { test } from 'node:test'

import { expandRepeatedRows, groupPanels } from './layout.ts'

import type { Panel } from './types.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

function panel(p: Partial<Panel> & { id: number }): Panel {
  return {
    type: 'stat',
    title: '',
    gridPos: { x: 0, y: 0, w: 6, h: 5 },
    targets: [],
    ...p,
  }
}

const PANELS: Panel[] = [
  panel({ id: 1, gridPos: { x: 0, y: 0, w: 24, h: 3 } }),
  panel({
    id: 2,
    type: 'row',
    gridPos: { x: 0, y: 3, w: 24, h: 1 },
    collapsed: false,
  }),
  panel({ id: 3, gridPos: { x: 0, y: 4, w: 12, h: 7 } }),
  panel({ id: 4, gridPos: { x: 12, y: 4, w: 12, h: 7 } }),
  panel({
    id: 15,
    type: 'row',
    gridPos: { x: 0, y: 11, w: 24, h: 1 },
    collapsed: true,
    panels: [
      panel({ id: 16, gridPos: { x: 0, y: 0, w: 24, h: 3 } }),
      panel({ id: 17, gridPos: { x: 0, y: 3, w: 6, h: 5 } }),
    ],
  }),
]

test('groups a preamble block and one section per row', () => {
  const sections = groupPanels(PANELS)

  assert.deepEqual(
    sections.map((s) => s.kind),
    ['panels', 'row', 'row'],
  )
  assert.deepEqual(
    sections.map((s) => s.block.panels.map((p) => p.panel.id)),
    [[1], [3, 4], [16, 17]],
  )
})

test('saved-expanded rows own the top-level panels that follow them', () => {
  const sections = groupPanels(PANELS)
  const row2 = sections[1]

  assert.ok(row2.kind === 'row')
  assert.equal(row2.row.id, 2)
  assert.equal(row2.block.heightRows, 7)
  // Side-by-side panels keep their x positions; y is renormalized to 0.
  assert.deepEqual(
    row2.block.panels.map((p) => [p.pos.x, p.pos.y]),
    [
      [0, 0],
      [12, 0],
    ],
  )
})

test('saved-collapsed rows take their children from the nested panels', () => {
  const sections = groupPanels(PANELS)
  const row15 = sections[2]

  assert.ok(row15.kind === 'row')
  assert.equal(row15.row.collapsed, true)
  assert.equal(row15.block.heightRows, 8)
  assert.deepEqual(
    row15.block.panels.map((p) => p.pos.y),
    [0, 3],
  )
})

test('block y positions are rebuilt from saved order, not saved coordinates', () => {
  // Nested panels of a collapsed row keep whatever y values they had when the
  // row was last open; blocks must normalize them, not trust them.
  const weird: Panel[] = [
    panel({
      id: 1,
      type: 'row',
      gridPos: { x: 0, y: 40, w: 24, h: 1 },
      collapsed: true,
      panels: [panel({ id: 2, gridPos: { x: 0, y: 99, w: 6, h: 5 } })],
    }),
  ]
  const sections = groupPanels(weird)

  assert.equal(sections.length, 1)
  assert.ok(sections[0].kind === 'row')
  assert.deepEqual(sections[0].block.panels[0].pos.y, 0)
  assert.equal(sections[0].block.heightRows, 5)
})

test('rows with no panels produce an empty block', () => {
  const sections = groupPanels([
    panel({ id: 1, type: 'row', gridPos: { x: 0, y: 0, w: 24, h: 1 } }),
  ])

  assert.ok(sections[0].kind === 'row')
  assert.equal(sections[0].block.panels.length, 0)
  assert.equal(sections[0].block.heightRows, 0)
})

test('children present both nested and top-level are deduped by id', () => {
  const dup = panel({ id: 2, gridPos: { x: 0, y: 0, w: 6, h: 5 } })
  const sections = groupPanels([
    panel({
      id: 1,
      type: 'row',
      gridPos: { x: 0, y: 0, w: 24, h: 1 },
      collapsed: true,
      panels: [dup],
    }),
    dup,
  ])

  assert.equal(sections.length, 1)
  assert.ok(sections[0].kind === 'row')
  assert.deepEqual(
    sections[0].block.panels.map((p) => p.panel.id),
    [2],
  )
})

test('repeated rows expand once per selected value with a single-value scope', () => {
  const sections = groupPanels([
    panel({
      id: 1,
      type: 'row',
      repeat: 'servers',
      gridPos: { x: 0, y: 0, w: 24, h: 1 },
      panels: [panel({ id: 2 })],
    }),
  ])
  const expanded = expandRepeatedRows(sections, {
    servers: [
      { value: 'uid-a', text: 'server-a', queryValue: 'uid-a' },
      { value: 'uid-b', text: 'server-b', queryValue: 'uid-b' },
    ],
  })

  assert.deepEqual(
    expanded.map((section) => section.repeat),
    [
      { name: 'servers', value: 'uid-a', text: 'server-a', queryValue: 'uid-a' },
      { name: 'servers', value: 'uid-b', text: 'server-b', queryValue: 'uid-b' },
    ],
  )
  assert.notEqual(expanded[0].key, expanded[1].key)
})
