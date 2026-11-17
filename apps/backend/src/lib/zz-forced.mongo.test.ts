// Scratch only (do not merge): proves the MongoDB step fails when a test skips.
import { expect, test } from 'bun:test'

test.skip('forced skip against the real MongoDB', () => {
  expect(1).toBe(1)
})
