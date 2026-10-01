import { describe, expect, test } from 'bun:test'

import { quantityValue } from './kube-quantity'

describe('quantityValue', () => {
  test('reads CPU in cores down to nano', () => {
    expect(quantityValue('250m')).toBe(0.25)
    expect(quantityValue('123456n')).toBeCloseTo(0.000123456, 9)
    expect(quantityValue('0.5')).toBe(0.5)
    expect(quantityValue('2')).toBe(2)
  })

  test('reads binary and decimal memory suffixes', () => {
    expect(quantityValue('5Mi')).toBe(5 * 1024 * 1024)
    expect(quantityValue('2G')).toBe(2e9)
    expect(quantityValue('1e3')).toBe(1000)
  })

  test('rejects garbage instead of guessing', () => {
    expect(quantityValue('')).toBeNull()
    expect(quantityValue('lots')).toBeNull()
    expect(quantityValue('1mm')).toBeNull()
  })
})
