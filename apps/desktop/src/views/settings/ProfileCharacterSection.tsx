import { useState } from 'react'

import { Avatar } from '../../components/Avatar'
import { ProfileCharacterImage } from '../../components/ProfileCharacterImage'
import { ProfileCharacterPicker } from '../../components/ProfileCharacterPicker'
import { useCharacterPick } from '../../hooks/useProfileCharacter'
import { hairstyleLabel } from '../../lib/profileCharacter'

import type { ProfileCharacter, UserInfo } from '../../types'

/**
 * The person's character: Boy or Girl, then a hairstyle. It is their picture in the
 * sidebar's account row, in every workspace. The preview loops while they choose.
 */
export function ProfileCharacterSection({
  user,
  onUserUpdated,
}: {
  user: UserInfo
  onUserUpdated: (user: UserInfo) => void
}) {
  const { chosen, note, pick } = useCharacterPick(user, onUserUpdated)
  const [preview, setPreview] = useState<ProfileCharacter | null>(null)
  const character = preview ?? chosen

  function choose(next: ProfileCharacter | null) {
    setPreview(null)
    if (next !== (chosen ?? null) || note?.kind === 'failed') void pick(next)
  }

  let hint = 'Showing your photo. Pick Boy or Girl for a character instead.'

  if (preview && preview !== chosen) hint = `Previewing ${hairstyleLabel(preview)}`
  else if (note && note.kind !== 'failed') hint = note.text
  else if (chosen) hint = 'Your picture at the bottom of the sidebar, in every workspace.'

  return (
    <section aria-labelledby="your-character" className="mt-10">
      <h2 id="your-character" className="text-[15px] font-semibold text-main">
        Your character
      </h2>
      <p className="mt-1 text-[13px] text-tertiary">
        Shown instead of your photo in your sidebar, or None to keep your photo. A character moves
        once when you point at it.
      </p>
      <div className="mt-4 rounded-xl border border-zGray-800 p-4">
        <div className="mb-4 flex items-center gap-3.5">
          <span className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full bg-zViolet-accent/10">
            {character ? (
              <ProfileCharacterImage character={character} looping className="h-full w-full" />
            ) : (
              <Avatar
                src={user.avatarURL}
                name={user.name || user.username || user.email}
                size={64}
                className="rounded-full !shadow-none"
              />
            )}
          </span>
          <div aria-live="polite" className="min-w-0 text-[12.5px] text-tertiary">
            {note?.kind === 'failed' && !preview ? (
              <span role="alert" className="text-red-400">
                Couldn't save your character.{' '}
                <button
                  type="button"
                  onClick={() => void pick(note.character)}
                  className="font-medium text-zViolet-accent underline-offset-2 hover:underline"
                >
                  Retry
                </button>
              </span>
            ) : (
              hint
            )}
          </div>
        </div>
        <ProfileCharacterPicker value={chosen} onPick={choose} onPreview={setPreview} />
      </div>
    </section>
  )
}
