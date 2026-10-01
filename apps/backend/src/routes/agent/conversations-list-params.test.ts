import { describe, expect, test } from 'bun:test'

import { parseArchivedParam, parseSortParam } from './conversations-list-params'

describe('conversation list params', () => {
  test('archived accepts exclude or only', () => {
    expect(parseArchivedParam(undefined)).toBeUndefined()
    expect(parseArchivedParam('only')).toBe('only')
    expect(() => parseArchivedParam('all')).toThrow("archived must be 'exclude' or 'only'")
  })

  test('sort accepts the archive order', () => {
    expect(parseSortParam(undefined, undefined)).toBeUndefined()
    expect(parseSortParam('archived', undefined)).toBe('archived')
    expect(parseSortParam('archived', 'only')).toBe('archived')
    expect(() => parseSortParam('newest', undefined)).toThrow('sort must be')
  })

  test('archive order cannot be combined with excluding the archive', () => {
    expect(() => parseSortParam('archived', 'exclude')).toThrow("sort 'archived'")
  })
})
