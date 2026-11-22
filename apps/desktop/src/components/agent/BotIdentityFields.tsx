import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../i18n'
import { Button } from '../ui/button'

import { botAvatarBackgroundColor } from '../../lib/botAvatarBackgrounds'

import { AgentAvatarGrid } from './AgentAvatarGrid'
import { AvatarBackgroundPicker } from './AvatarBackgroundPicker'
import { BotAvatarImage } from './BotAvatarImage'

import type { BotAvatarBackground } from '../../lib/botAvatarBackgrounds'
import type { BotAvatarFile } from '../../lib/botAvatars'
import type { ReactNode } from 'react'

/** Shared name and face controls for creating and editing a Bot. */
export function BotIdentityFields({
  name,
  onNameChange,
  avatar,
  onAvatarChange,
  background,
  onBackgroundChange,
  photo,
  busy,
  disabled = false,
  submitLabel,
  identityLocked = false,
  children,
}: {
  name: string
  onNameChange: (name: string) => void
  avatar?: BotAvatarFile
  onAvatarChange: (avatar: BotAvatarFile) => void
  /** With `onBackgroundChange`, the tint the face sits on is picked here too. */
  background?: BotAvatarBackground
  onBackgroundChange?: (background: BotAvatarBackground) => void
  photo?: string
  busy: boolean
  disabled?: boolean
  submitLabel: string
  /** A partially created Bot keeps its identity while setup is retried. */
  identityLocked?: boolean
  children?: ReactNode
}) {
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const shown = preview ?? avatar

  return (
    <>
      <div className="flex items-center gap-3">
        {shown ? (
          <span className="relative size-10 shrink-0">
            {botAvatarBackgroundColor(background) && (
              <span
                className="absolute inset-0 rounded-full"
                style={{ background: botAvatarBackgroundColor(background) }}
              />
            )}
            <BotAvatarImage file={shown} className="relative size-10 object-contain" />
          </span>
        ) : (
          <img src={photo} alt="" className="size-10 shrink-0 rounded-full object-cover" />
        )}
        <input
          aria-label={t('Bot name')}
          placeholder={t('Name')}
          autoFocus
          maxLength={120}
          value={name}
          disabled={busy || identityLocked}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') event.stopPropagation()
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          className="min-w-0 flex-1 rounded-md border border-main bg-main px-3 py-2 text-[13px] text-main outline-none focus:border-line-focus"
        />
        <Button
          type="submit"
          variant="neutral"
          size="sm"
          disabled={busy || disabled || !name.trim()}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
      {children}
      <fieldset disabled={busy || identityLocked} className="m-0 min-w-0 border-0 p-0">
        <AgentAvatarGrid value={avatar} onChange={onAvatarChange} onPreview={setPreview} />
        {onBackgroundChange && (
          <div className="mt-3">
            <AvatarBackgroundPicker value={background ?? 'none'} onChange={onBackgroundChange} />
          </div>
        )}
      </fieldset>
    </>
  )
}
