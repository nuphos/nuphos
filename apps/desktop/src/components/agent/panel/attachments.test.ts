import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, mock, test } from 'node:test'

import type { makeAttachmentTurn as MakeAttachmentTurn } from './attachments.ts'
import type { UserInfo } from '../../../types'

let makeAttachmentTurn: typeof MakeAttachmentTurn
const user: UserInfo = {
  id: 'sender',
  name: 'Yuan',
  username: 'yuan',
  email: 'yuan@example.com',
  avatarURL: 'https://lh3.googleusercontent.com/avatar',
}

before(async () => {
  mock.module('../../../api.ts', { namedExports: { api: {} } })
  mock.module('../../ui/toast.ts', { namedExports: { toast: {} } })
  mock.module('./stall.ts', { namedExports: { uid: randomUUID } })
  mock.module('./textUtils.ts', {
    namedExports: { fileNameFromPath: (path: string) => path.split('/').at(-1) },
  })
  ;({ makeAttachmentTurn } = await import('./attachments.ts'))
})

test('text, image, and uploading messages have sender details on their first render', () => {
  for (const kind of ['text', 'image', 'upload']) {
    const turn = makeAttachmentTurn(
      'hello',
      kind === 'image'
        ? [{ type: 'image', mediaType: 'image/png', url: 'data:image/png;base64,AA==' }]
        : [],
      kind === 'upload' ? ['/files/log.txt'] : [],
      'team',
      { currentUser: user },
    )
    const message = turn.buildUserMsg(kind === 'upload' ? turn.optimisticPart() : null)

    assert.deepEqual(message.metadata?.sender, {
      type: 'user',
      id: user.id,
      displayName: user.name,
      avatarURL: user.avatarURL,
    })
    assert.equal(message.metadata?.source, 'nuphos')
    assert.ok(message.createdAt)
    assert.equal(message.metadata?.sentAt, new Date(message.createdAt).toISOString())
    const ready = turn.buildUserMsg({
      type: 'transfer-upload',
      groupId: 'group',
      status: 'ready',
      files: [],
    })

    assert.equal(ready.id, message.id)
    assert.equal(ready.createdAt, message.createdAt)
    assert.deepEqual(ready.metadata, message.metadata)
  }
})

test('optimistic attribution uses the same name fallback and avatar restrictions as the server', () => {
  const message = makeAttachmentTurn('hi', [], [], 'team', {
    currentUser: { ...user, name: '', avatarURL: 'https://untrusted.example/avatar' },
  }).buildUserMsg(null)

  assert.equal(message.metadata?.sender.displayName, user.username)
  assert.equal(message.metadata?.sender.avatarURL, undefined)
  assert.equal(makeAttachmentTurn('hi', [], [], 'team').buildUserMsg(null).metadata, undefined)
})
