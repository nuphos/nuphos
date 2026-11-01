import { describe, expect, test } from 'bun:test'

import { replaceSchema } from './designs'

const page = { id: 'p1', name: 'Page 1', objects: [], links: [] }

describe('PUT /designs/:designId body', () => {
  test('a rename needs no updatedAt', () => {
    expect(replaceSchema.safeParse({ name: 'Checkout' }).success).toBe(true)
  })

  test('replacing pages needs the updatedAt the caller last read', () => {
    const missing = replaceSchema.safeParse({ pages: [page] })

    expect(missing.success).toBe(false)
    expect(missing.error?.issues[0]?.path).toEqual(['updatedAt'])
    expect(
      replaceSchema.safeParse({ pages: [page], updatedAt: '2026-10-28T01:00:00.000Z' }).success,
    ).toBe(true)
  })

  test('updatedAt must be a timestamp', () => {
    expect(replaceSchema.safeParse({ pages: [page], updatedAt: 'yesterday' }).success).toBe(false)
  })
})
