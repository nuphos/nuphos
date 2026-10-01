import { afterEach, describe, expect, test } from 'bun:test'

import {
  BetterStackApiError,
  betterStackApiErrorMessage,
  getBetterStackOutgoingWebhook,
} from './betterstack'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Better Stack API errors', () => {
  test('extracts JSON:API array errors', () => {
    expect(
      betterStackApiErrorMessage(
        {
          errors: [{ title: 'Not Found', detail: 'Outgoing webhook does not exist' }],
        },
        404,
      ),
    ).toBe('Outgoing webhook does not exist')
  })

  test('extracts keyed validation errors', () => {
    expect(
      betterStackApiErrorMessage(
        {
          errors: { base: ['Outgoing webhook does not exist'] },
        },
        404,
      ),
    ).toBe('Outgoing webhook does not exist')
  })

  test('preserves the provider status instead of throwing a parser TypeError', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: { base: ['Outgoing webhook does not exist'] } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch

    const error = await getBetterStackOutgoingWebhook(
      { uptimeApiToken: 'test-token' },
      '84410',
    ).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(BetterStackApiError)
    expect((error as BetterStackApiError).status).toBe(404)
    expect((error as Error).message).toBe('Outgoing webhook does not exist')
  })
})
