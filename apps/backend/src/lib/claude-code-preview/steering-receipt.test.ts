import { expect, test } from 'bun:test'

import { attributeReceipt, createSteeringAttribution } from './steering-receipt'

import type { MessageMetadata } from '@/lib/agent/message-metadata'

const ADA: MessageMetadata = {
  version: 1,
  sender: { type: 'user', id: 'u-ada', displayName: 'Ada' },
  source: 'nuphos',
  sentAt: '2026-09-29T00:00:00.000Z',
}

test('attributes every receipt to the turn actor with its own sent time', async () => {
  const seen: string[] = []
  const attribution = createSteeringAttribution('u-ada', (userId) => {
    seen.push(userId)

    return Promise.resolve(ADA)
  })

  await Promise.resolve()
  const first = attribution()
  const second = attribution()

  expect(seen).toEqual(['u-ada'])
  expect(first?.sender).toEqual(ADA.sender)
  expect(first?.source).toBe('nuphos')
  expect(first?.sentAt).not.toBe(ADA.sentAt)
  expect(Date.parse(second?.sentAt ?? '')).toBeGreaterThanOrEqual(Date.parse(first?.sentAt ?? ''))
})

test('leaves the receipt unattributed until the lookup resolves or when it fails', async () => {
  let resolve!: (metadata: MessageMetadata) => void
  const pending = createSteeringAttribution(
    'u-ada',
    () =>
      new Promise<MessageMetadata>((r) => {
        resolve = r
      }),
  )

  expect(pending()).toBeUndefined()
  resolve(ADA)
  await Promise.resolve()
  expect(pending()?.sender.displayName).toBe('Ada')

  let attempts = 0
  const flaky = createSteeringAttribution('u-ada', () => {
    attempts++

    return attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(ADA)
  })

  await Promise.resolve()
  await Promise.resolve()
  expect(flaky()).toBeUndefined()
  expect(attempts).toBe(2)
  await Promise.resolve()
  expect(flaky()?.sender.displayName).toBe('Ada')
  expect(attempts).toBe(2)
})

test('a receipt that arrived before the lookup resolved is backfilled at its receipt time', () => {
  const entry = {
    type: 'data-steering' as const,
    data: { id: 'r', text: 'Focus' },
    receivedAt: '2026-09-29T01:02:03.000Z',
  }

  expect(attributeReceipt(entry)).toEqual({ type: 'data-steering', data: entry.data })
  expect(attributeReceipt(entry, () => undefined)).toEqual({
    type: 'data-steering',
    data: entry.data,
  })
  expect(
    attributeReceipt(entry, (sentAt) => ({ ...ADA, sentAt: sentAt ?? '' })).data.metadata,
  ).toEqual({
    ...ADA,
    sentAt: entry.receivedAt,
  })
  const own = { ...entry, data: { ...entry.data, metadata: ADA } }

  expect(attributeReceipt(own, () => ({ ...ADA, sentAt: 'later' })).data.metadata).toBe(ADA)
})
