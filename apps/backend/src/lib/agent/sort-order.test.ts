import { describe, expect, test } from 'bun:test'

import { byCodeUnit } from './sort-order'

// Each expectation below is the output of `[...input].sort()` with no
// comparator. If `byCodeUnit` ever diverges from these, every hash and
// canonical-JSON call site that switched to it silently changes.
const CASES: { name: string; input: string[]; expected: string[] }[] = [
  {
    name: 'uppercase sorts before lowercase',
    input: ['banana', 'Apple', 'apple', 'Banana'],
    expected: ['Apple', 'Banana', 'apple', 'banana'],
  },
  {
    name: 'digits and punctuation sort before letters',
    input: ['b', '1', 'a', '_', '-', '10', '2'],
    expected: ['-', '1', '10', '2', '_', 'a', 'b'],
  },
  {
    name: 'ASCII sorts before non-ASCII',
    input: ['zebra', '啟動', 'apple', 'Ärger'],
    expected: ['apple', 'zebra', 'Ärger', '啟動'],
  },
  {
    name: 'prefixes sort before their extensions',
    input: ['skill', 'skill-store', 'skill.md', 'skil'],
    expected: ['skil', 'skill', 'skill-store', 'skill.md'],
  },
  {
    name: 'ISO-8601 timestamps sort chronologically',
    input: ['2026-01-02T00:00:00.000Z', '2025-12-31T23:59:59.999Z', '2026-01-02T00:00:00.001Z'],
    expected: ['2025-12-31T23:59:59.999Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.001Z'],
  },
]

function sign(n: number): number {
  if (n > 0) return 1

  return n < 0 ? -1 : 0
}

describe('byCodeUnit', () => {
  for (const { name, input, expected } of CASES) {
    test(name, () => {
      expect([...input].sort(byCodeUnit)).toEqual(expected)
    })
  }

  test('is a consistent total order', () => {
    const values = ['a', 'A', 'b', '1', '_', '啟', 'a']

    for (const left of values) {
      for (const right of values) {
        const forward = byCodeUnit(left, right)
        const reversed = byCodeUnit(right, left)

        expect(sign(forward)).toBe(sign(-reversed))
      }
    }
  })

  test('reports equal strings as equal', () => {
    expect(byCodeUnit('same', 'same')).toBe(0)
  })
})
