import { expect, test } from 'bun:test'

import { attributionHeader } from '@/lib/agent/message-metadata'

import { steeringMessageId, steeringReceipt, steeringText } from './steering-receipt'

test('a steering receipt names its attached files', () => {
  expect(steeringText('Look', [])).toBe('Look')
  expect(steeringText('Look', ['a.png', 'b, c.pdf'])).toBe(
    'Look\n\n[Attached: a.png]\n[Attached: b, c.pdf]',
  )
  expect(steeringText('', ['a.png'])).toBe('[Attached: a.png]')
})

test('a steer sent with an upload group shows its files again', () => {
  const groupId = '0123456789abcdef01234567'
  const id = steeringMessageId(groupId)
  const text = steeringText('Look', ['a.png', 'b, c.pdf'])

  expect(steeringReceipt(id, text).upload).toEqual({
    type: 'transfer-upload',
    groupId,
    status: 'ready',
    files: [
      { fileName: 'a.png', size: null, status: 'ready' },
      { fileName: 'b, c.pdf', size: null, status: 'ready' },
    ],
  })
  expect(steeringReceipt(id, steeringText('', ['a.png'])).upload?.files).toHaveLength(1)
  // Text-only steers, and text that merely looks like a receipt, carry no files.
  expect(steeringReceipt(id, 'Look')).toEqual({ id, text: 'Look' })
  for (let i = 0; i < 200; i++)
    expect(steeringReceipt(steeringMessageId(), text).upload).toBeUndefined()
})

test('a receipt from an older runtime drops the echoed attribution header', () => {
  const header = attributionHeader('m1', {
    version: 1,
    sender: { type: 'user', id: 'u1', displayName: 'Ada', email: 'ada@example.com' },
    source: 'nuphos',
    sentAt: '2026-10-28T16:16:47.873Z',
  })
  const groupId = '0123456789abcdef01234567'
  const id = steeringMessageId(groupId)
  const words = steeringText('Can we speed it up?', ['a.png'])

  // Older runtimes joined every text part with a newline.
  expect(header).not.toBe('')
  expect(steeringReceipt('m1', `${header}\nCan we speed it up?`).text).toBe('Can we speed it up?')
  expect(steeringReceipt(id, `${header}\n${words}`).upload?.files).toHaveLength(1)
  // Current runtimes echo only the words.
  expect(steeringReceipt('m1', 'Can we speed it up?').text).toBe('Can we speed it up?')
})

test('steers reusing one upload group keep separate receipts', () => {
  const groupId = '0123456789abcdef01234567'
  const first = steeringMessageId(groupId)
  const second = steeringMessageId(groupId)

  expect(first).not.toBe(second)
  // The runtime rejects steering ids that are not UUIDs.
  for (const id of [first, second, steeringMessageId()])
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/)
  expect(steeringReceipt(second, steeringText('Again', ['a.png'])).upload?.groupId).toBe(groupId)
})
