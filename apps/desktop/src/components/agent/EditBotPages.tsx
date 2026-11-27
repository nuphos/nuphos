import { AlarmClock } from 'lucide-react'
import { useState } from 'react'

import { t } from '../../i18n'
import { botAvatarBackgroundColor } from '../../lib/botAvatarBackgrounds'
import { Field } from '../../views/settings/shared'
import { inputClasses } from '../../views/settings/styles'

import { AgentAvatarGrid } from './AgentAvatarGrid'
import { AvatarBackgroundPicker } from './AvatarBackgroundPicker'
import { BotAvatarImage } from './BotAvatarImage'
import { TriggerRow } from './summary/TriggerRow'
import { useTriggers } from './summary/useTriggers'

import type { BotAvatarBackground } from '../../lib/botAvatarBackgrounds'
import type { BotAvatarFile } from '../../lib/botAvatars'
import type { ReactNode } from 'react'

/** A Field for a group of controls: a label element would hand its clicks to the first one. */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] text-tertiary">{hint}</span>}
    </div>
  )
}

/** The Bot's name and face. A Bot wearing a photo has no character picked, so no tint either. */
export function GeneralPage({
  name,
  onNameChange,
  avatar,
  onAvatarChange,
  background,
  onBackgroundChange,
  photo,
}: {
  name: string
  onNameChange: (name: string) => void
  avatar?: BotAvatarFile
  onAvatarChange: (avatar: BotAvatarFile) => void
  background: BotAvatarBackground
  onBackgroundChange: (background: BotAvatarBackground) => void
  photo?: string
}) {
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const shown = preview ?? avatar
  const tint = botAvatarBackgroundColor(background)

  return (
    <>
      <div className="flex items-end gap-4">
        {shown ? (
          <span className="relative size-14 shrink-0">
            {tint && (
              <span className="absolute inset-0 rounded-full" style={{ background: tint }} />
            )}
            <BotAvatarImage file={shown} className="relative size-14 object-contain" />
          </span>
        ) : (
          <img src={photo} alt="" className="size-14 shrink-0 rounded-full object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <Field label={t('Name')}>
            <input
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              }}
              className={inputClasses}
            />
          </Field>
        </div>
      </div>
      <Group label={t('Character')}>
        <AgentAvatarGrid
          value={avatar}
          onChange={onAvatarChange}
          onPreview={setPreview}
          columns={10}
          start
        />
      </Group>
      {avatar && (
        <Group label={t('Background')}>
          <AvatarBackgroundPicker value={background} onChange={onBackgroundChange} start />
        </Group>
      )}
    </>
  )
}

/** The Bot's Triggers, each switch applied at once; Edit hands the change to the chat. */
function BotTriggers({
  teamId,
  sessionId,
  name,
  onEdit,
}: {
  teamId: string
  sessionId: string
  name: string
  onEdit?: (message: string) => void
}) {
  const { triggers, loaded, error, pending, toggle } = useTriggers(teamId, sessionId)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <Group
      label={t('Triggers')}
      hint={t('Switches apply right away. Ask {name} in chat to add or change a trigger.', {
        name,
      })}
    >
      {error && (
        <p role="alert" className="mb-1.5 text-xs text-status-danger">
          {t('Could not update triggers. Try again.')}
        </p>
      )}
      {!loaded && !error && <p className="text-xs text-tertiary">{t('Loading…')}</p>}
      {loaded && triggers.length === 0 && (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line-control px-4 py-6 text-center">
          <AlarmClock aria-hidden strokeWidth={1.75} className="mb-1 size-4 text-tertiary" />
          <p className="text-[13px] font-medium text-main">{t('No triggers yet')}</p>
          <p className="text-xs text-tertiary">
            {t('Ask {name} in chat to schedule recurring work.', { name })}
          </p>
        </div>
      )}
      {triggers.length > 0 && (
        <div className="divide-y divide-line-control rounded-lg border border-line-control">
          {triggers.map((trigger) => (
            <div key={trigger.id} className="px-3 py-1">
              <TriggerRow
                trigger={trigger}
                open={openId === trigger.id}
                busy={pending.has(trigger.id)}
                onToggleOpen={() => setOpenId((open) => (open === trigger.id ? null : trigger.id))}
                onToggle={(enabled) => void toggle(trigger, enabled)}
                onEdit={onEdit}
              />
            </div>
          ))}
        </div>
      )}
    </Group>
  )
}

/** The Bot's instructions, saved with the rest, and its Triggers, which switch at once. */
export function AdvancedPage({
  teamId,
  sessionId,
  name,
  instructions,
  onInstructionsChange,
  onEditTrigger,
}: {
  teamId: string
  sessionId: string
  name: string
  instructions: string
  onInstructionsChange: (instructions: string) => void
  onEditTrigger?: (message: string) => void
}) {
  return (
    <>
      <Field
        label={t('Instructions')}
        hint={t('Markdown. {name} follows these from its next turn.', { name })}
      >
        <textarea
          value={instructions}
          placeholder={t('Tell this Bot how to work…')}
          onChange={(event) => onInstructionsChange(event.target.value)}
          className={`${inputClasses} block h-[180px] resize-y py-2 font-mono text-[12.5px]`}
        />
      </Field>
      <BotTriggers teamId={teamId} sessionId={sessionId} name={name} onEdit={onEditTrigger} />
    </>
  )
}
