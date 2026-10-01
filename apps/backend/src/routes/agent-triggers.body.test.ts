import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { jsonObjectBody } from './agent-triggers'

function request(body: unknown) {
  return {
    req: {
      json: async () => (typeof body === 'function' ? (body as () => never)() : body),
    },
  }
}

async function statusOf(body: unknown): Promise<number> {
  try {
    await jsonObjectBody(request(body))

    return 200
  } catch (error) {
    return error instanceof AppError ? error.status : 500
  }
}

describe('trigger route body parsing', () => {
  test('returns the object so callers can narrow its fields', async () => {
    expect(await jsonObjectBody(request({ userId: 'u1' }))).toEqual({ userId: 'u1' })
  })

  test('rejects bodies that are not objects with 400, never a crash', async () => {
    // `c.req.json<T>()` is only a TypeScript assertion, so each of these used
    // to reach a property read and surface as a 500.
    for (const body of [null, [], 'text', 42, true]) {
      expect([body, await statusOf(body)]).toEqual([body, 400])
    }
  })

  test('rejects malformed JSON with 400', async () => {
    expect(
      await statusOf(() => {
        throw new SyntaxError('Unexpected end of JSON input')
      }),
    ).toBe(400)
  })
})
