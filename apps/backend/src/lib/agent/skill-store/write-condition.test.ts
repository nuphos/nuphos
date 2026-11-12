import { describe, expect, test } from 'bun:test'

import { conditionalWriteError, conditionHeaders, PreconditionFailedError } from './write-condition'

const s3Error = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })

describe('conditional skill writes', () => {
  test('send a quoted If-Match, or If-None-Match for a new object', () => {
    expect(conditionHeaders({ ifMatch: 'abc' })).toEqual({ IfMatch: '"abc"' })
    expect(conditionHeaders({ ifNoneMatch: '*' })).toEqual({ IfNoneMatch: '*' })
    expect(conditionHeaders(undefined)).toEqual({})
  })

  test.each([
    ['PreconditionFailed', 412],
    ['ConditionalRequestConflict', 409],
    ['NoSuchKey', 404],
  ])('a conditional write answered %s fails as a changed object', (name, status) => {
    expect(conditionalWriteError(s3Error(name, status), 'k', { ifMatch: 'abc' })).toBeInstanceOf(
      PreconditionFailedError,
    )
  })

  test('an unconditional write keeps the store error', () => {
    const err = s3Error('PreconditionFailed', 412)

    expect(conditionalWriteError(err, 'k', undefined)).toBe(err)
  })
})
