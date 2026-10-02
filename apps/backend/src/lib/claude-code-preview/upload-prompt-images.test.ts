import { expect, spyOn, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import * as transfers from '@/lib/file-transfer/service'

import { uploadPromptImages } from './upload-prompt-images'

const scope = {
  teamId: new ObjectId('69e989027ab63e8d6a0ffcb6'),
  userId: 'sender',
  sessionId: 'chat',
}

test('large images upload unchanged to storage rather than entering ACP frames', async () => {
  const bytes = Buffer.alloc(1_100_000, 37)
  let uploaded: Buffer | undefined
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(request.method).toBe('PUT')
      expect(request.headers.get('content-type')).toBe('image/png')
      uploaded = Buffer.from(await request.arrayBuffer())

      return new Response(null, { status: 200 })
    },
  })
  const create = spyOn(transfers, 'createTransfer').mockResolvedValue({
    groupId: 'images',
    files: [{ uploadUrl: server.url.toString() }],
  } as Awaited<ReturnType<typeof transfers.createTransfer>>)
  const finalize = spyOn(transfers, 'finalizeTransfer').mockResolvedValue({
    status: 'ready',
  } as never)

  try {
    expect(await uploadPromptImages(scope, [])).toBeNull()
    expect(create).not.toHaveBeenCalled()
    expect(
      await uploadPromptImages(scope, [
        {
          type: 'image',
          name: 'screen.png',
          mimeType: 'image/png',
          data: bytes.toString('base64'),
        },
      ]),
    ).toBe('images')
    expect(uploaded).toEqual(bytes)
    expect(create.mock.calls[0]![0]).toEqual(scope)
    expect(create.mock.calls[0]![2][0]).toMatchObject({
      fileName: 'screen.png',
      size: bytes.length,
    })
    expect(finalize).toHaveBeenCalledWith(scope, 'images')
    finalize.mockResolvedValue({ status: 'failed' } as never)
    await expect(
      uploadPromptImages(scope, [{ type: 'image', mimeType: 'image/png', data: 'AA==' }]),
    ).rejects.toThrow('did not finish')
  } finally {
    create.mockRestore()
    finalize.mockRestore()
    await server.stop()
  }
})

test('image filenames match the encoded media type after Desktop conversion', async () => {
  const create = spyOn(transfers, 'createTransfer').mockResolvedValue({
    groupId: 'images',
    files: [],
  } as never)
  const finalize = spyOn(transfers, 'finalizeTransfer').mockResolvedValue({
    status: 'ready',
  } as never)

  try {
    await uploadPromptImages(
      scope,
      ['screen.png', 'photo.bmp', 'photo.jpeg', 'PHOTO.JPG', 'paste', undefined].map((name) => ({
        type: 'image',
        name,
        mimeType: 'image/jpeg',
        data: 'AA==',
      })),
    )
    expect(create.mock.calls[0]![2].map((file) => file.fileName)).toEqual([
      'screen.jpg',
      'photo.jpg',
      'photo.jpeg',
      'PHOTO.JPG',
      'paste.jpg',
      'image-6.jpg',
    ])
    expect(create.mock.calls[0]![2].every((file) => file.contentType === 'image/jpeg')).toBe(true)
  } finally {
    create.mockRestore()
    finalize.mockRestore()
  }
})
