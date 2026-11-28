import { useEffect, useRef } from 'react'

import { t } from '../../../i18n'
import { isMac } from '../../../lib/platform'
import { Button } from '../../ui/button'

import { ComposerVoiceButton } from './ComposerVoiceButton'
import { DictationBar } from './DictationBar'
import { useVoiceDictation } from './useVoiceDictation'
import { dictationInsert, isVoiceShortcut } from './voiceDictation'

/**
 * A question answered in words: a field and "Send", opened by "Other…"; in a form,
 * no button, the card's one Send being its own (`action={null}`). Esc
 * closes it; the caller keeps `text`, so what was typed is there when it opens again.
 * With `voiceTeamId`, a microphone (or mod+shift+U) dictates: while it records, a
 * bar like the iOS composer's takes the field's place. ■ puts the transcript in
 * the field to be read and sent; ↑ sends it as soon as it is in.
 */
export function AnswerField({
  text,
  onText,
  onSend,
  onClose,
  label = t('Your answer'),
  action = t('Send'),
  optional = false,
  maxLength,
  voiceTeamId,
  autoFocus = true,
}: {
  text: string
  onText: (text: string) => void
  onSend: (text: string) => void
  onClose: () => void
  /** The field's name, shown while it is empty. */
  label?: string
  /** What the button does; null for none, where Return alone sends. */
  action?: string | null
  /** It may be sent empty. */
  optional?: boolean
  /** The most characters it takes, where the server takes no more. */
  maxLength?: number
  voiceTeamId?: string
  /** It takes the caret as it opens; false for one shown from the start, as a form's "Reply…". */
  autoFocus?: boolean
}) {
  const field = useRef<HTMLInputElement>(null)
  const voice = useVoiceDictation({
    teamId: voiceTeamId,
    meter: true,
    onText: (spoken, { send }) => {
      const next = text + dictationInsert(spoken, text)

      onText(next)
      if (send && next.trim()) onSend(next.trim())
    },
  })

  const idle = voice.phase.kind === 'idle'

  // On opening, and when a take ends: the field is back, with any transcript in it.
  const focusNext = useRef(autoFocus)

  useEffect(() => {
    if (!idle) focusNext.current = true
    else if (focusNext.current) field.current?.focus()
  }, [idle])

  if (!idle)
    return (
      <DictationBar
        phase={voice.phase}
        elapsedMs={voice.elapsedMs}
        levels={voice.levels}
        onCancel={voice.cancel}
        onStop={() => voice.stop()}
        onSend={() => voice.stop({ send: true })}
      />
    )

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (optional || text.trim()) onSend(text.trim())
      }}
    >
      <input
        ref={field}
        type="text"
        value={text}
        maxLength={maxLength}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (voice.available && isVoiceShortcut(event.nativeEvent, isMac)) {
            event.preventDefault()
            voice.toggle()

            return
          }
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
        aria-label={label}
        placeholder={optional ? label : undefined}
        className="h-[38px] min-w-0 flex-1 rounded-[10px] bg-surface-raised px-3 text-[13.5px] text-main shadow-[0_0_0_1px_rgb(var(--color-line-control))] outline-none placeholder:text-tertiary focus:shadow-[0_0_0_1px_rgb(var(--color-line-focus)),0_0_0_4px_rgba(28,26,23,0.05)]"
      />
      {voice.available && <ComposerVoiceButton hero={false} onStart={() => void voice.start()} />}
      {action !== null && (
        <Button
          type="submit"
          size="md"
          className="h-[38px] px-3.5 text-[13px]"
          disabled={!optional && !text.trim()}
        >
          {action}
          <kbd className="rounded bg-white/15 px-1 text-[11px] font-normal">↵</kbd>
        </Button>
      )}
    </form>
  )
}
