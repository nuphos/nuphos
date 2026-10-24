import { useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { usePlayOnce } from '../hooks/usePlayOnce'
import { imageMotion, loopingSvgUrl, readyLoopingSvgUrl } from '../lib/botAvatarMotion'
import { profileCharacterLabel, profileCharacterSrc } from '../lib/profileCharacter'

import type { ProfileCharacter } from '../types'

/**
 * The person's profile character, with the Agent avatars' motion rule: still by default,
 * and each new `plays` count plays the idle loop once (hover, focus, a level-up).
 * `looping` repeats it, for the picker while the person is choosing. Reduce motion keeps
 * it still.
 */
export function ProfileCharacterImage({
  character,
  looping = false,
  plays = 0,
  className,
}: {
  character: ProfileCharacter
  looping?: boolean
  plays?: number
  className?: string
}) {
  const src = profileCharacterSrc(character)
  const motion = imageMotion({ reduceMotion: useReducedMotion() ?? false, looping })
  const loop = motion === 'loop'
  const [, setLoaded] = useState(0)
  const once = usePlayOnce(src)
  const { play } = once

  useEffect(() => {
    if (!loop || readyLoopingSvgUrl(src)) return
    let current = true

    void loopingSvgUrl(src).then((url) => {
      if (url && current) setLoaded((count) => count + 1)
    })

    return () => {
      current = false
    }
  }, [src, loop])

  useEffect(() => {
    if (plays > 0 && motion === 'on-request') play()
    // Only a new play count starts a play; a re-render or new character does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plays])

  const moving = loop ? readyLoopingSvgUrl(src) : once.url

  return (
    <img
      src={moving ?? src}
      alt={profileCharacterLabel(character)}
      draggable={false}
      className={className}
    />
  )
}
