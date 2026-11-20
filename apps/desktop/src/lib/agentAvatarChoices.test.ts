import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agentAvatarBackground,
  agentAvatarPick,
  pickAgentAvatar,
  receiveAgentAvatars,
} from './agentAvatarChoices.ts'

test('fetched conversations say which Agents have a pick and which do not', () => {
  assert.equal(agentAvatarPick('never-fetched'), undefined)
  receiveAgentAvatars([{ sessionId: 'a' }, { sessionId: 'b', avatar: '07-ada' }], Date.now())
  assert.equal(agentAvatarPick('a'), null)
  assert.equal(agentAvatarPick('b'), '07-ada')
})

test('a fetch that started before the save landed cannot undo the pick', async () => {
  receiveAgentAvatars([{ sessionId: 'c' }], Date.now())
  let finish = () => {}
  const startedBefore = Date.now() - 1
  const saving = pickAgentAvatar(
    'c',
    '05-rembrandt',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )

  assert.equal(agentAvatarPick('c'), '05-rembrandt')
  // Arrives while the save is in flight.
  receiveAgentAvatars([{ sessionId: 'c' }], startedBefore)
  assert.equal(agentAvatarPick('c'), '05-rembrandt')
  finish()
  await saving
  // Started before the save, arrives after it.
  receiveAgentAvatars([{ sessionId: 'c' }], startedBefore)
  assert.equal(agentAvatarPick('c'), '05-rembrandt')
  // A later fetch is the truth again, even if someone else changed it.
  receiveAgentAvatars([{ sessionId: 'c', avatar: '07-ada' }], Date.now() + 1)
  assert.equal(agentAvatarPick('c'), '07-ada')
})

test('a failed save puts back exactly what was known before', async () => {
  receiveAgentAvatars([{ sessionId: 'd', avatar: '07-ada' }], Date.now())
  await assert.rejects(
    pickAgentAvatar('d', '10-van-gogh', () => Promise.reject(new Error('offline'))),
  )
  assert.equal(agentAvatarPick('d'), '07-ada')
  // Never fetched: stays unknown, so rows keep the avatar they were fetched with.
  await assert.rejects(
    pickAgentAvatar('e', '10-van-gogh', () => Promise.reject(new Error('offline'))),
  )
  assert.equal(agentAvatarPick('e'), undefined)
})

test("a Bot's background comes with its face, and goes when the face does", () => {
  assert.equal(agentAvatarBackground('never-fetched'), undefined)
  receiveAgentAvatars(
    [
      { sessionId: 'f', avatar: '07-ada', avatarBackground: 'sky' },
      { sessionId: 'g', avatar: '07-ada' },
    ],
    Date.now(),
  )
  assert.equal(agentAvatarBackground('f'), 'sky')
  assert.equal(agentAvatarBackground('g'), null)
  receiveAgentAvatars([{ sessionId: 'f' }], Date.now() + 1)
  assert.equal(agentAvatarBackground('f'), null)
})

test('a background picked with the face shows at once and comes back off on a failed save', async () => {
  receiveAgentAvatars([{ sessionId: 'h', avatar: '07-ada', avatarBackground: 'mint' }], Date.now())
  await pickAgentAvatar('h', '07-ada', () => Promise.resolve(), 'peach')
  assert.equal(agentAvatarBackground('h'), 'peach')
  // None is no background.
  await pickAgentAvatar('h', '07-ada', () => Promise.resolve(), 'none')
  assert.equal(agentAvatarBackground('h'), null)
  await assert.rejects(
    pickAgentAvatar('h', '07-ada', () => Promise.reject(new Error('offline')), 'rose'),
  )
  assert.equal(agentAvatarBackground('h'), null)
  // Changing only the face keeps the background.
  await pickAgentAvatar('h', '05-rembrandt', () => Promise.resolve(), 'sage')
  await pickAgentAvatar('h', '07-ada', () => Promise.resolve())
  assert.equal(agentAvatarBackground('h'), 'sage')
})
