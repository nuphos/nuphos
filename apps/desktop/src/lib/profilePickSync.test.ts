import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BADGE_STAT_SLOT,
  pendingPick,
  pendingValue,
  savePick,
  saveValue,
  shownCharacter,
} from './profilePickSync.ts'

import type { PickStorage } from './profilePickSync.ts'
import type { ProfileCharacter, ProfileSaveResult, UserInfo } from '../types/team.ts'

const user: UserInfo = { id: 'u1', name: 'Alex', email: 'a@example.com', username: 'alex' }

function memory(): PickStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()

  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const answer = (result: ProfileSaveResult | Error) => async (_c: ProfileCharacter | null) => {
  if (result instanceof Error) throw result

  return result
}

test('a saved pick comes back as the user and leaves nothing pending', async () => {
  const storage = memory()
  const saved = { ...user, character: 'girl-pony' as const }
  const outcome = await savePick('girl-pony', 'u1', { storage, send: answer({ user: saved }) })

  assert.deepEqual(outcome, { kind: 'saved', user: saved })
  assert.equal(pendingPick(storage, 'u1'), undefined)
})

test('a server without the route (404) keeps the pick on this computer, shown in the ring', async () => {
  const storage = memory()
  const outcome = await savePick('boy-curly', 'u1', {
    storage,
    send: answer({ unsupported: true }),
  })

  assert.deepEqual(outcome, { kind: 'kept-here' })
  assert.equal(pendingPick(storage, 'u1'), 'boy-curly')
  assert.equal(shownCharacter(user, pendingPick(storage, 'u1')), 'boy-curly')
})

test('a network error fails out loud and keeps the pick for a retry', async () => {
  const storage = memory()
  const outcome = await savePick('girl-waves', 'u1', {
    storage,
    send: answer(new Error('fetch failed')),
  })

  assert.deepEqual(outcome, { kind: 'failed', message: 'fetch failed' })
  assert.equal(pendingPick(storage, 'u1'), 'girl-waves')
})

test('an unknown stored value is ignored, and picks are kept per person', () => {
  const storage = memory()

  storage.setItem('nuphos.profileCharacter.pending.u1', 'dragon')
  assert.equal(pendingPick(storage, 'u1'), undefined)
  assert.equal(shownCharacter({ ...user, character: 'boy-side' }, undefined), 'boy-side')
  storage.setItem('nuphos.profileCharacter.pending.u2', 'girl-bangs')
  assert.equal(pendingPick(storage, 'u1'), undefined)
})

test('the badge stat is kept and synced the same way, under its own key', async () => {
  const storage = memory()
  const saved = { ...user, badgeStat: 'waiting' as const }

  const kept = await saveValue(BADGE_STAT_SLOT, 'quota', 'u1', {
    storage,
    send: async () => ({ unsupported: true }),
  })

  assert.deepEqual(kept, { kind: 'kept-here' })
  assert.equal(pendingValue(BADGE_STAT_SLOT, storage, 'u1'), 'quota')
  assert.equal(pendingPick(storage, 'u1'), undefined, 'a stat never reads as a character')

  const result = await saveValue(BADGE_STAT_SLOT, 'waiting', 'u1', {
    storage,
    send: async () => ({ user: saved }),
  })

  assert.deepEqual(result, { kind: 'saved', user: saved })
  assert.equal(pendingValue(BADGE_STAT_SLOT, storage, 'u1'), undefined)
  storage.setItem('nuphos.badgeStat.pending.u1', 'xp')
  assert.equal(
    pendingValue(BADGE_STAT_SLOT, storage, 'u1'),
    undefined,
    'an unknown stat is ignored',
  )
})

test('None goes back to the photo: the server is sent null and nothing shows as a character', async () => {
  const storage = memory()
  const sent: (ProfileCharacter | null)[] = []
  const cleared = { ...user }

  const kept = await savePick('photo', 'u1', {
    storage,
    send: async (character) => {
      sent.push(character)

      return { unsupported: true }
    },
  })

  assert.deepEqual(kept, { kind: 'kept-here' })
  assert.deepEqual(sent, [null])
  assert.equal(pendingPick(storage, 'u1'), 'photo')
  // A pending None hides a saved character until the server catches up.
  assert.equal(shownCharacter({ ...user, character: 'boy-fringe' }, 'photo'), undefined)
  assert.equal(shownCharacter(user, undefined), undefined, 'no pick is the photo too')

  const saved = await savePick('photo', 'u1', { storage, send: async () => ({ user: cleared }) })

  assert.deepEqual(saved, { kind: 'saved', user: cleared })
  assert.equal(pendingPick(storage, 'u1'), undefined)
})
