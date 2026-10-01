import { useState } from 'react'

import { initials, initialsFontSize } from '../lib/avatarInitials'
import { avatarGradient } from '../lib/avatarPalette'
import { reportFrontendError } from '../lib/frontendErrorReporter'

type Props = {
  src?: string | null
  name: string
  size?: number
  className?: string
}

export function Avatar({ src, name, size = 28, className = '' }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src) && src !== failedSrc
  // Default to a rounded square, but yield to any `rounded-*` the consumer
  // passes — otherwise both utilities land on the element and the winner is
  // decided by stylesheet order, which e.g. leaves a rounded-square image
  // inside a circular (`rounded-full`) ring.
  const rounding = /(^|\s)rounded(-|\b)/.test(className) ? '' : 'rounded-md'
  const text = initials(name)
  const gradient = avatarGradient(name)

  return (
    <div
      className={[
        rounding,
        'overflow-hidden flex items-center justify-center',
        showImage ? 'bg-transparent' : 'shadow-sm shadow-black/25',
        className,
      ].join(' ')}
      style={{
        width: size,
        height: size,
        ...(showImage
          ? null
          : {
              backgroundImage: `linear-gradient(to bottom right, ${gradient.from}, ${gradient.to})`,
            }),
      }}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={name}
          referrerPolicy="no-referrer"
          width={size}
          height={size}
          className="w-full h-full object-cover"
          onError={() => {
            reportFrontendError({
              source: 'resource_load',
              phase: 'avatar_image_error',
              message: 'Avatar image failed to load.',
            })
            setFailedSrc(src ?? null)
          }}
        />
      ) : (
        <span
          className="text-white font-semibold leading-none"
          style={{ fontSize: initialsFontSize(text, size) }}
        >
          {text}
        </span>
      )}
    </div>
  )
}
