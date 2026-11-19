import { expect, test } from 'bun:test'

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
