import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { pendingPick, pendingPickKey, savePick, shownCharacter } from '../lib/profilePickSync'
import { profileCharacterLabel } from '../lib/profileCharacter'

import { notifyPendingPick, usePendingPick } from './usePendingPick'

import type { ProfileCharacter, UserInfo } from '../types'

export type PickNote =
  | { kind: 'saved' | 'kept-here'; text: string }
  | { kind: 'failed'; character: ProfileCharacter | null }

/**
 * Picks show at once and are kept on this computer until the server takes them. A
 * server without the character route keeps the pick here and syncs it on a later
 * visit; any other failure says so with a Retry.
 */
export function useCharacterPick(user: UserInfo, onUserUpdated: (user: UserInfo) => void) {
  const pending = usePendingPick(user.id)
  const [note, setNote] = useState<PickNote | null>(null)
  const latest = useRef<ProfileCharacter | null | undefined>(undefined)

  /** A character, or null for none: the person's photo again. */
  async function pick(next: ProfileCharacter | null) {
    latest.current = next
    const outcome = savePick(next ?? 'photo', user.id, {
      storage: localStorage,
      send: api.authSetCharacter,
    })

    notifyPendingPick()
    const result = await outcome

    notifyPendingPick()
    if (latest.current !== next) return
    if (result.kind === 'saved') onUserUpdated(result.user)
    if (result.kind === 'saved')
      setNote({
        kind: 'saved',
        text: next ? `Saved · ${profileCharacterLabel(next)}` : 'Saved · your photo',
      })
    else if (result.kind === 'kept-here')
      setNote({ kind: 'kept-here', text: 'Saved on this computer' })
    else setNote({ kind: 'failed', character: next })
  }

  // A pick kept here earlier goes up quietly once the server can take it.
  useEffect(() => {
    const waiting = pendingPick(localStorage, user.id)

    if (!waiting) return
    if (waiting === (user.character ?? 'photo')) {
      localStorage.removeItem(pendingPickKey(user.id))
      notifyPendingPick()

      return
    }
    void savePick(waiting, user.id, { storage: localStorage, send: api.authSetCharacter }).then(
      (result) => {
        notifyPendingPick()
        if (result.kind === 'saved') onUserUpdated(result.user)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per person, not on every pick
  }, [user.id])

  return { chosen: shownCharacter(user, pending), note, pick }
}
