import { cloneElement, isValidElement } from 'react'

import { ChatIcon } from '../channels/channelParts'

import type { Item } from './types'
import type { ComponentProps } from 'react'

/** Give the actual avatar renderer a size; scaling its wrapper leaves the face small. */
export function BotPinFace({ item, size }: { item: Item; size: number }) {
  // Bots already wears its rows' faces (withChatSections), so a pin shows the same one.
  const face = item.iconNode

  if (isValidElement<ComponentProps<typeof ChatIcon>>(face) && face.type === ChatIcon)
    return cloneElement(face, { size, sidebar: false, looping: item.labelShimmer })

  return (
    <span className="inline-flex items-center justify-center" style={{ width: size, height: size }}>
      {face}
    </span>
  )
}
