// Scratch only (do not merge): proves the MongoDB step fails when a test fails.
import { expect, test } from 'bun:test'

test.skipIf(!process.env.TEST_MONGODB_URI)('forced failure against the real MongoDB', () => {
  expect(1).toBe(2)
})
