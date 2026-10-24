import { useEffect, useRef, useState } from 'react'

import { createPlayOnce, playOnceSvgUrl } from '../lib/botAvatarMotion'

import type { PlayOnce } from '../lib/botAvatarMotion'

/**
 * The play-once copy of the SVG at `src` while it plays, else undefined. `play()` plays the
 * idle loop once from the start; a new `src` drops whatever was playing.
 */
export function usePlayOnce(src: string): { url: string | undefined; play: () => void } {
  const [shown, setShown] = useState<{ src: string; url: string }>()
  const controller = useRef<PlayOnce | undefined>(undefined)

  useEffect(() => {
    const current = createPlayOnce(
      () => playOnceSvgUrl(src),
      (url) => setShown(url ? { src, url } : undefined),
    )

    controller.current = current

    return () => {
      current.dispose()
      if (controller.current === current) controller.current = undefined
    }
  }, [src])

  return {
    url: shown?.src === src ? shown.url : undefined,
    play: () => controller.current?.play(),
  }
}
