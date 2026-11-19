import { expect, test } from 'bun:test'

import { persistedImagePart } from './image-parts'
import { restoreAppMessageMetadata } from './message-metadata'

const image = {
  type: 'file',
  mediaType: 'image/png',
  url: 'data:image/png;base64,aGVsbG8=',
  filename: 'screenshot.png',
}
const metadata = {
  version: 1 as const,
  source: 'nuphos' as const,
  sender: { type: 'user' as const, id: 'sender', displayName: 'Sender' },
  sentAt: '2026-10-02T18:00:00Z',
}

test('first chat image survives transcript sync racing ahead of the chat request', () => {
  const storedImage = persistedImagePart(image)
  const messages = [{ id: 'first', role: 'user', parts: [image] as unknown[], metadata }]

  restoreAppMessageMetadata(messages, [
    {
      messageId: 'first',
      role: 'user',
      parts: [storedImage],
      metadata,
    },
  ])
  expect(messages[0]!.parts).toEqual([storedImage])
  expect(storedImage).toEqual({
    type: 'image',
    mediaType: 'image/png',
    url: image.url,
    fileName: 'screenshot.png',
  })
})
