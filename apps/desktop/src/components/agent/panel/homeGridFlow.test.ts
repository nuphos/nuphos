import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cardsInReadingOrder, compactAround, compactGrid, moveCard } from './homeGridFlow.ts'

test('cardsInReadingOrder reads the grid row by row, left to right', () => {
  const grid = [
    { i: 'c', x: 0, y: 7, w: 6, h: 7 },
    { i: 'b', x: 6, y: 0, w: 6, h: 7 },
    { i: 'a', x: 0, y: 0, w: 6, h: 7 },
  ]

  assert.deepEqual(
    cardsInReadingOrder(grid).map((item) => item.i),
    ['a', 'b', 'c'],
  )
})

test('moveCard trades places with the neighbour in reading order', () => {
  const grid = [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'a', x: 0, y: 8, w: 6, h: 7 },
    { i: 'b', x: 6, y: 8, w: 6, h: 7 },
  ]

  assert.deepEqual(moveCard(grid, 'b', -1), [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'b', x: 0, y: 8, w: 6, h: 7 },
    { i: 'a', x: 6, y: 8, w: 6, h: 7 },
  ])
  assert.deepEqual(moveCard(grid, 'team', 1), [
    { i: 'a', x: 0, y: 0, w: 6, h: 7 },
    { i: 'team', x: 0, y: 7, w: 12, h: 8 },
    { i: 'b', x: 0, y: 15, w: 6, h: 7 },
  ])
})

test('moveCard keeps sizes and leaves the first and last cards at the ends', () => {
  const grid = [
    { i: 'a', x: 0, y: 0, w: 4, h: 5 },
    { i: 'b', x: 4, y: 0, w: 8, h: 9 },
  ]

  assert.equal(moveCard(grid, 'a', -1), grid)
  assert.equal(moveCard(grid, 'b', 1), grid)
  assert.equal(moveCard(grid, 'missing', 1), grid)
  assert.deepEqual(moveCard(grid, 'a', 1), [
    { i: 'b', x: 0, y: 0, w: 8, h: 9 },
    { i: 'a', x: 8, y: 0, w: 4, h: 5 },
  ])
})

test('compactGrid closes gaps and keeps each card in reading order and size', () => {
  // A layout saved with an empty row, a hole on the right and a card left far below.
  const saved = [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'a', x: 0, y: 10, w: 6, h: 7 },
    { i: 'b', x: 0, y: 17, w: 6, h: 7 },
    { i: 'c', x: 6, y: 40, w: 4, h: 3 },
  ]

  assert.deepEqual(compactGrid(saved), [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'a', x: 0, y: 8, w: 6, h: 7 },
    { i: 'b', x: 6, y: 8, w: 6, h: 7 },
    { i: 'c', x: 0, y: 15, w: 4, h: 3 },
  ])
})

test('compactGrid leaves a compact grid as it is and keeps extra fields', () => {
  const grid = [
    { i: 'a', x: 0, y: 0, w: 6, h: 7, minW: 3 },
    { i: 'b', x: 6, y: 0, w: 6, h: 6, minW: 3 },
    { i: 'c', x: 6, y: 6, w: 6, h: 6, minW: 3 },
  ]

  assert.deepEqual(compactGrid(grid), grid)
  assert.deepEqual(compactGrid(compactGrid(grid)), compactGrid(grid))
})

test('compactGrid moves cards aside for one dropped over them', () => {
  // `b` dragged onto the top left, over `a`: it goes first and `a` follows it.
  const midDrag = [
    { i: 'a', x: 0, y: 1, w: 6, h: 7 },
    { i: 'c', x: 6, y: 0, w: 6, h: 7 },
    { i: 'b', x: 0, y: 0, w: 6, h: 7 },
  ]

  assert.deepEqual(
    compactGrid(midDrag).map(({ i, x, y }) => [i, x, y]),
    [
      ['b', 0, 0],
      ['c', 6, 0],
      ['a', 0, 7],
    ],
  )
})

test('a keyboard move ends in the same layout a drop there compacts to', () => {
  const grid = compactGrid([
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'a', x: 0, y: 8, w: 6, h: 7 },
    { i: 'b', x: 6, y: 8, w: 6, h: 7 },
  ])
  const dropped = grid.map((item) => (item.i === 'b' ? { ...item, x: 0, y: 8 } : item))
  const pushed = dropped.map((item) => (item.i === 'a' ? { ...item, y: 15 } : item))

  assert.deepEqual(moveCard(grid, 'b', -1), compactGrid(pushed))
})

test('compactAround puts a card dragged onto another card in its place', () => {
  const before = ['team', 'pulls', 'ci', 'panel']
  // The panel dragged onto the pull requests card, which the library pushed down.
  const midDrag = [
    { i: 'team', x: 0, y: 0, w: 12, h: 8 },
    { i: 'pulls', x: 0, y: 14, w: 6, h: 7 },
    { i: 'ci', x: 6, y: 8, w: 6, h: 7 },
    { i: 'panel', x: 0, y: 8, w: 6, h: 6 },
  ]

  assert.deepEqual(
    compactAround(midDrag, 'panel', before).map(({ i, x, y }) => [i, x, y]),
    [
      ['team', 0, 0],
      ['panel', 0, 8],
      ['pulls', 6, 8],
      ['ci', 0, 14],
    ],
  )
})

test('compactAround keeps the other cards in their order from before the drag', () => {
  const before = ['a', 'b', 'c']
  // `c` dragged to the end while the library pushed `a` below `b`.
  const midDrag = [
    { i: 'a', x: 0, y: 9, w: 6, h: 4 },
    { i: 'b', x: 6, y: 0, w: 6, h: 4 },
    { i: 'c', x: 6, y: 20, w: 6, h: 4 },
  ]

  assert.deepEqual(
    compactAround(midDrag, 'c', before).map((item) => item.i),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(compactAround(midDrag, 'missing', before), compactGrid(midDrag))
})
