import { useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { usePlayOnce } from '../../hooks/usePlayOnce'
import {
  imageMotion,
  loopingBotAvatarUrl,
  readyLoopingBotAvatarUrl,
} from '../../lib/botAvatarMotion'

import type { BotAvatarFile } from '../../lib/botAvatars'
import type React from 'react'

/**
 * One bot avatar character, still by default. Pointing at it plays the idle loop once;
 * `looping` repeats it, for an agent with a running turn. Reduce motion keeps it still.
 * A still image costs nothing to paint, so a long sidebar only pays for what moves.
 */
export function BotAvatarImage({
  file,
  looping = false,
  className,
  style,
}: {
  file: BotAvatarFile
  looping?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const src = `/bot-avatars/${file}`
  const motion = imageMotion({ reduceMotion: useReducedMotion() ?? false, looping })
  const loop = motion === 'loop'
  const [, setLoaded] = useState(0)
  const once = usePlayOnce(src)

  useEffect(() => {
    if (!loop || readyLoopingBotAvatarUrl(file)) return
    let current = true

    void loopingBotAvatarUrl(file).then((url) => {
      if (url && current) setLoaded((count) => count + 1)
    })

    return () => {
      current = false
    }
  }, [file, loop])

  const moving = loop ? readyLoopingBotAvatarUrl(file) : once.url

  return (
    <img
      src={moving ?? src}
      alt=""
      draggable={false}
      onPointerEnter={() => {
        if (motion === 'on-request') once.play()
      }}
      className={className}
      style={style}
    />
  )
}
