import { describe, expect, test } from 'bun:test'
import { Decimal128, ObjectId } from 'mongodb'

import {
  cachedMongoCatalog,
  inferMongoSchema,
  invalidateMongoCatalogCache,
  sanitizeMongoViewPipeline,
} from '@/lib/database-catalog'

describe('inferMongoSchema', () => {
  test('infers presence and BSON types without returning sampled values', () => {
    const schema = inferMongoSchema([
      {
        _id: new ObjectId(),
        name: 'Ada',
        active: true,
        profile: { age: 32 },
        tags: ['admin', 'beta'],
      },
      {
        _id: new ObjectId(),
        name: 'Lin',
        profile: { age: Decimal128.fromString('41.5') },
        tags: [],
      },
    ])

    expect(schema.sampleSize).toBe(2)
    expect(schema.fields.find((field) => field.path === 'active')?.presence).toBe(0.5)
    expect(schema.fields.find((field) => field.path === '_id')?.types).toEqual([
      { type: 'objectId', count: 2 },
    ])
    expect(schema.fields.find((field) => field.path === 'profile.age')?.types).toEqual([
      { type: 'decimal', count: 1 },
      { type: 'double', count: 1 },
    ])
    expect(JSON.stringify(schema)).not.toContain('Ada')
    expect(JSON.stringify(schema)).not.toContain('admin')
  })

  test('describes array item shapes using an explicit [] path', () => {
    const schema = inferMongoSchema([{ items: [{ sku: 'A' }, { sku: 'B' }] }])

    expect(schema.fields.find((field) => field.path === 'items')?.types[0]).toEqual({
      type: 'array',
      count: 1,
    })
    expect(schema.fields.find((field) => field.path === 'items[].sku')?.occurrences).toBe(2)
  })
})

describe('sanitizeMongoViewPipeline', () => {
  test('keeps pipeline structure while removing literals and sensitive values', () => {
    const result = sanitizeMongoViewPipeline([
      {
        $match: {
          status: 'active',
          email: 'person@example.test',
          token: 'top-secret',
          attempts: 3,
        },
      },
      { $project: { status: 1, internal: 0, computed: '$profile.score' } },
      { $lookup: { from: 'orders', localField: '_id', foreignField: 'customerId', as: 'orders' } },
    ])

    expect(result.truncated).toBe(false)
    expect(result.pipeline).toEqual([
      {
        $match: {
          status: '[string]',
          email: '[REDACTED]',
          token: '[REDACTED]',
          attempts: '[number]',
        },
      },
      { $project: { status: 1, internal: 0, computed: '$profile.score' } },
      { $lookup: { from: 'orders', localField: '_id', foreignField: 'customerId', as: 'orders' } },
    ])
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain('person@example.test')
    expect(serialized).not.toContain('top-secret')
    expect(serialized).not.toContain('active')
  })

  test('marks oversized pipelines as truncated', () => {
    const result = sanitizeMongoViewPipeline(Array.from({ length: 51 }, () => ({ $match: {} })))

    expect(result.pipeline).toHaveLength(50)
    expect(result.truncated).toBe(true)
  })
})

describe('cachedMongoCatalog', () => {
  test('deduplicates metadata loads and supports refresh and invalidation', async () => {
    const connectionId = 'cache-test-connection'

    invalidateMongoCatalogCache(connectionId)
    let loads = 0
    const loader = async () => ({ generation: ++loads })

    expect(await cachedMongoCatalog([connectionId, 'databases'], false, loader, 1)).toEqual({
      generation: 1,
    })
    expect(await cachedMongoCatalog([connectionId, 'databases'], false, loader, 2)).toEqual({
      generation: 1,
    })
    expect(await cachedMongoCatalog([connectionId, 'databases'], true, loader, 3)).toEqual({
      generation: 2,
    })
    invalidateMongoCatalogCache(connectionId)
    expect(await cachedMongoCatalog([connectionId, 'databases'], false, loader, 4)).toEqual({
      generation: 3,
    })
  })

  test('does not retain failed loads', async () => {
    const connectionId = 'cache-test-failure'

    invalidateMongoCatalogCache(connectionId)
    let attempts = 0

    await expect(
      cachedMongoCatalog(
        [connectionId, 'databases'],
        false,
        async () => {
          attempts += 1
          throw new Error('catalog unavailable')
        },
        1,
      ),
    ).rejects.toThrow('catalog unavailable')
    await expect(
      cachedMongoCatalog(
        [connectionId, 'databases'],
        false,
        async () => {
          attempts += 1
          throw new Error('catalog unavailable')
        },
        2,
      ),
    ).rejects.toThrow('catalog unavailable')
    expect(attempts).toBe(2)
  })
})
