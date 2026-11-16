import { useEffect, useRef } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

/**
 * A question answered in words: a field and "Send", opened by "Other…". Esc
 * closes it; the caller keeps `text`, so what was typed is there when it opens again.
 */
export function AnswerField({
  text,
  onText,
  onSend,
  onClose,
}: {
  text: string
  onText: (text: string) => void
  onSend: (text: string) => void
  onClose: () => void
}) {
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => field.current?.focus(), [])

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onSend(text.trim())
      }}
    >
      <input
        ref={field}
        type="text"
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
        aria-label={t('Your answer')}
        className="h-[38px] min-w-0 flex-1 rounded-[10px] bg-surface-raised px-3 text-[13.5px] text-main shadow-[0_0_0_1px_rgb(var(--color-line-control))] outline-none placeholder:text-tertiary focus:shadow-[0_0_0_1px_rgb(var(--color-line-focus)),0_0_0_4px_rgba(28,26,23,0.05)]"
      />
      <Button
        type="submit"
        size="md"
        className="h-[38px] px-3.5 text-[13px]"
        disabled={!text.trim()}
      >
        {t('Send')}
        <kbd className="rounded bg-white/15 px-1 text-[11px] font-normal">↵</kbd>
      </Button>
    </form>
  )
}
