import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  FALLBACK_WIDTH,
  MAX_MEASURED_WIDTH,
  MAX_PINNED_WIDTH,
  MIN_MEASURED_WIDTH,
  MIN_RESIZE_WIDTH,
  clampMeasured,
  clampResized,
  distributeSlack,
  effectiveGrow,
  layoutColumnWidths,
  mergeForStorage,
  resolveBaseWidths,
  sanitizePersistedWidths,
} from './tableColumnWidths.ts'

import { stickyLayout } from './tableStickyLayout.ts'

import type { ColumnWidthSpec } from './tableColumnWidths.ts'

test('a column that declared nothing falls back, a declared width is kept', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name' }, { key: 'range', width: 160 }]

  assert.deepEqual(resolveBaseWidths(specs, {}, {}), {
    name: FALLBACK_WIDTH,
    range: 160,
  })
})

test('priority is user drag > measured > declared', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 100 },
    { key: 'b', width: 100 },
  ]

  assert.deepEqual(resolveBaseWidths(specs, { a: 300 }, { a: 200, b: 220 }), {
    a: 300,
    b: 220,
  })
})

test('minWidth floors every source', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'a', width: 10, minWidth: 48 }]

  assert.deepEqual(resolveBaseWidths(specs, {}, {}), { a: 48 })
  assert.deepEqual(resolveBaseWidths(specs, { a: 12 }, {}), { a: 48 })
})

test('measured widths are clamped, declared widths are not', () => {
  assert.equal(clampMeasured({ key: 'a' }, 12), MIN_MEASURED_WIDTH)
  assert.equal(clampMeasured({ key: 'a' }, 9000), MAX_MEASURED_WIDTH)
  assert.equal(clampMeasured({ key: 'a', maxWidth: 200 }, 9000), 200)
  assert.equal(clampMeasured({ key: 'a', minWidth: 300 }, 12), 300)
  // A narrow actions column keeps the width it declared.
  assert.deepEqual(resolveBaseWidths([{ key: 'actions', width: 48 }], {}, {}), {
    actions: 48,
  })
})

test('minWidth above maxWidth wins — clipping controls beats the ceiling', () => {
  assert.equal(clampMeasured({ key: 'a', minWidth: 300, maxWidth: 200 }, 100), 300)
})

test('with no declared grow, the first unsized column absorbs the slack', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'icon', width: 40 },
    { key: 'name' },
    { key: 'updated', width: 160 },
  ]

  assert.deepEqual(effectiveGrow(specs), [0, 1, 0])
})

test('a table that sized every column by hand keeps its layout', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 100 },
    { key: 'b', width: 100 },
  ]

  assert.deepEqual(effectiveGrow(specs), [0, 0])
  assert.deepEqual(distributeSlack(specs, { a: 100, b: 100 }, 1000), {
    a: 100,
    b: 100,
  })
})

test('any declared grow switches off the implicit rule', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'name' },
    { key: 'detail', grow: 2 },
    { key: 'updated', width: 160 },
  ]

  assert.deepEqual(effectiveGrow(specs), [0, 2, 0])
})

test('slack is split in proportion to grow', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 100, grow: 1 },
    { key: 'b', width: 100, grow: 3 },
    { key: 'c', width: 100 },
  ]

  assert.deepEqual(distributeSlack(specs, { a: 100, b: 100, c: 100 }, 700), {
    a: 200,
    b: 400,
    c: 100,
  })
})

test('a column hitting maxWidth returns its share to the other growers', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 100, grow: 1, maxWidth: 150 },
    { key: 'b', width: 100, grow: 1 },
  ]

  assert.deepEqual(distributeSlack(specs, { a: 100, b: 100 }, 600), {
    a: 150,
    b: 450,
  })
})

test('every grower saturating leaves the rest to the spacer column', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'a', width: 100, grow: 1, maxWidth: 150 }]

  assert.deepEqual(distributeSlack(specs, { a: 100 }, 9000), { a: 150 })
})

test('columns overflowing the container are left to scroll', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 400, grow: 1 },
    { key: 'b', width: 400 },
  ]

  assert.deepEqual(distributeSlack(specs, { a: 400, b: 400 }, 300), { a: 400, b: 400 })
})

test('an unknown container width never grows anything', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'a' }]

  assert.deepEqual(layoutColumnWidths(specs, { available: 0 }), { a: FALLBACK_WIDTH })
  assert.deepEqual(layoutColumnWidths(specs, { available: NaN }), { a: FALLBACK_WIDTH })
})

test('a user-dragged column is pinned and stops growing', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name' }, { key: 'updated', width: 160 }]

  assert.deepEqual(layoutColumnWidths(specs, { available: 1000 }), {
    name: 840,
    updated: 160,
  })
  assert.deepEqual(layoutColumnWidths(specs, { available: 1000, userWidths: { name: 300 } }), {
    name: 300,
    updated: 160,
  })
})

test('the dashboards list layout fills its pane instead of the spacer', () => {
  // NAME declares no width; RANGE/UPDATED are 160 and the actions column 48.
  const specs: ColumnWidthSpec[] = [
    { key: 'name' },
    { key: 'range', width: 160 },
    { key: 'updated', width: 160 },
    { key: 'actions', width: 48 },
  ]
  const widths = layoutColumnWidths(specs, { available: 2000, measured: { name: 420 } })

  assert.deepEqual(widths, { name: 1632, range: 160, updated: 160, actions: 48 })
  const total = Object.values(widths).reduce((sum, w) => sum + w, 0)

  assert.equal(total, 2000)
})

test('widths stay whole pixels and never overshoot the pane', () => {
  // A fractional overshoot would show up as a 1px horizontal scrollbar.
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 100, grow: 1 },
    { key: 'b', width: 100, grow: 1 },
    { key: 'c', width: 100, grow: 1 },
  ]

  for (const available of [1000, 1001, 1002, 777, 1234.5]) {
    const widths = layoutColumnWidths(specs, { available })
    let total = 0

    for (const w of Object.values(widths)) {
      assert.equal(w, Math.trunc(w), `fractional width at available=${available}`)
      total += w
    }
    assert.equal(total, Math.floor(available))
  }
})

test('a column can never be dragged away entirely', () => {
  // A pinned column never grows or re-fits, so a zero width would hide the
  // handle needed to get it back.
  assert.equal(clampResized({ key: 'a' }, 0), MIN_RESIZE_WIDTH)
  assert.equal(clampResized({ key: 'a' }, -50), MIN_RESIZE_WIDTH)
  assert.equal(clampResized({ key: 'a', minWidth: 90 }, 0), 90)
  // Still narrower than the fitting floor, so a tight actions column can be
  // tightened further by hand.
  assert.ok(MIN_RESIZE_WIDTH < MIN_MEASURED_WIDTH)
  assert.equal(clampResized({ key: 'a' }, 300), 300)
})

test('unusable persisted entries are dropped rather than pinning a column', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'a' }, { key: 'b', minWidth: 90 }]

  assert.deepEqual(
    sanitizePersistedWidths(specs, { a: 0, b: -1 }),
    {},
    'zero and negative widths must not survive',
  )
  assert.deepEqual(sanitizePersistedWidths(specs, { a: 10, b: 10 }), {
    a: MIN_RESIZE_WIDTH,
    b: 90,
  })
  assert.deepEqual(sanitizePersistedWidths(specs, { a: '200' }), {})
  assert.deepEqual(sanitizePersistedWidths(specs, { a: NaN }), {})
  assert.deepEqual(sanitizePersistedWidths(specs, { c: 200 }), {}, 'unknown column')
  for (const junk of [null, undefined, 'nope', 42, []]) {
    assert.deepEqual(sanitizePersistedWidths(specs, junk), {})
  }
  assert.deepEqual(sanitizePersistedWidths(specs, { a: 200.6 }), { a: 201 })
})

test('writing back leaves hidden columns alone', () => {
  // A table with conditional columns must not delete the widths of the columns
  // that happen to be hidden on this render.
  assert.deepEqual(
    mergeForStorage({ a: 100, b: 200, hidden: 300 }, { a: 150 }, ['a', 'b']),
    { a: 150, hidden: 300 },
    'b was rendered with no user width, so its entry clears; hidden passes through',
  )
})

test('writing back clears the entry a double-click reset', () => {
  assert.deepEqual(mergeForStorage({ a: 100 }, {}, ['a']), {})
})

test('writing back tolerates a corrupt existing blob', () => {
  assert.deepEqual(mergeForStorage('garbage', { a: 100 }, ['a']), { a: 100 })
  assert.deepEqual(mergeForStorage({ a: 0, b: 'x' }, { c: 50 }, ['c']), { c: 50 })
})

test('growing stops at the pane even with an odd number of growers', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'a', width: 100, grow: 2 },
    { key: 'b', width: 100, grow: 1 },
    { key: 'c', width: 100, grow: 1 },
    { key: 'd', width: 100, grow: 3 },
  ]

  for (let available = 400; available < 460; available++) {
    const widths = layoutColumnWidths(specs, { available })
    const total = Object.values(widths).reduce((sum, w) => sum + w, 0)

    assert.equal(total, available)
  }
})

test('nothing pinned leaves the spacer at the end', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name' }, { key: 'age' }]

  assert.deepEqual(stickyLayout(specs, { name: 200, age: 80 }), {
    spacerAt: 2,
    pins: {},
    pinnedLead: false,
  })
})

test('pinned columns stack by the widths outside them', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'name' },
    { key: 'copy', pin: 'right' },
    { key: 'menu', pin: 'right' },
  ]

  assert.deepEqual(stickyLayout(specs, { name: 200, copy: 220, menu: 60 }), {
    spacerAt: 1,
    pins: {
      menu: { edge: 'right', offset: 0, shade: false },
      copy: { edge: 'right', offset: 60, shade: true },
    },
    pinnedLead: false,
  })
})

test('a pinned column that does not reach its edge is ignored', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'stray', pin: 'right' },
    { key: 'name' },
    { key: 'menu', pin: 'right' },
  ]

  assert.deepEqual(stickyLayout(specs, { stray: 100, name: 200, menu: 60 }), {
    spacerAt: 2,
    pins: { menu: { edge: 'right', offset: 0, shade: true } },
    pinnedLead: false,
  })
})

test('an unmeasured pinned column stacks on the shared default width', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'copy', pin: 'right' },
    { key: 'menu', pin: 'right' },
  ]

  assert.deepEqual(stickyLayout(specs, {}).pins.copy, {
    edge: 'right',
    offset: FALLBACK_WIDTH,
    shade: true,
  })
})

test('a leading run pins left, starting after the checkbox column', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'name', pin: 'left' },
    { key: 'target' },
    { key: 'menu', pin: 'right' },
  ]

  assert.deepEqual(stickyLayout(specs, { name: 240, target: 320, menu: 60 }, 36), {
    spacerAt: 2,
    pins: {
      menu: { edge: 'right', offset: 0, shade: true },
      name: { edge: 'left', offset: 36, shade: true },
    },
    pinnedLead: true,
  })
})

test('only the innermost column of each run casts a shade', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'icon', pin: 'left' },
    { key: 'name', pin: 'left' },
    { key: 'target' },
  ]
  const { pins } = stickyLayout(specs, { icon: 40, name: 240, target: 320 })

  assert.deepEqual(pins.icon, { edge: 'left', offset: 0, shade: false })
  assert.deepEqual(pins.name, { edge: 'left', offset: 40, shade: true })
})

test('the two runs never claim the same column', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'only', pin: 'left' },
    { key: 'menu', pin: 'right' },
  ]
  const { pins, spacerAt } = stickyLayout(specs, { only: 240, menu: 60 })

  assert.equal(spacerAt, 1)
  assert.equal(pins.only.edge, 'left')
  assert.equal(pins.menu.edge, 'right')
})

test('a fitted pinned column is capped at a share of the pane', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name', minWidth: 220, pin: 'left' }, { key: 'target' }]
  const widths = layoutColumnWidths(specs, { measured: { name: 465 }, available: 840 })

  // 30% of 840 is under the absolute cap, so the share decides.
  assert.equal(widths.name, 252)
})

test('the pinned cap never falls below the column minWidth', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name', minWidth: 220, pin: 'left' }, { key: 'target' }]
  const widths = layoutColumnWidths(specs, { measured: { name: 465 }, available: 400 })

  assert.equal(widths.name, 220)
})

test('a wide pane hands the pinned column the absolute cap, not more', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name', minWidth: 220, pin: 'left' }, { key: 'target' }]
  const widths = layoutColumnWidths(specs, { measured: { name: 465 }, available: 2000 })

  assert.equal(widths.name, MAX_PINNED_WIDTH)
})

test('a declared width on a pinned column is taken as-is', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name' }, { key: 'menu', width: 60, pin: 'right' }]
  const widths = layoutColumnWidths(specs, { available: 2000 })

  assert.equal(widths.menu, 60)
})

test('a width the user dragged onto a pinned column outranks the cap', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name', minWidth: 220, pin: 'left' }, { key: 'target' }]
  const widths = layoutColumnWidths(specs, {
    userWidths: { name: 460 },
    measured: { name: 465 },
    available: 840,
  })

  assert.equal(widths.name, 460)
})

test('a pinned column never absorbs slack, however it asked to', () => {
  const specs: ColumnWidthSpec[] = [
    { key: 'name', width: 200, grow: 1, pin: 'left' },
    { key: 'target', width: 200, grow: 1 },
  ]

  assert.deepEqual(effectiveGrow(specs), [0, 1])
  assert.deepEqual(layoutColumnWidths(specs, { available: 600 }), { name: 200, target: 400 })
})

test('the implicit grower skips a pinned column', () => {
  const specs: ColumnWidthSpec[] = [{ key: 'name', pin: 'left' }, { key: 'target' }]

  assert.deepEqual(effectiveGrow(specs), [0, 1])
})
