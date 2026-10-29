import clsx from 'clsx'
import { ChevronDown, CornerUpLeft, X } from 'lucide-react'
import { useRef } from 'react'

import { t } from '../../../i18n'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'

import { composerOf } from './modelSelectorParts'

import type { ComposerReplyTarget } from './replyTarget'
import type { MouseEvent } from 'react'

// A click on the chip keeps the caret in the composer.
const keepComposerFocus = (event: MouseEvent) => event.preventDefault()

/** Which open question the next message answers, above the composer; with several, a menu picks one. */
export function ReplyTargetChip({
  target,
  sidebar = false,
}: {
  target: ComposerReplyTarget
  sidebar?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chosen = target.questions.find((question) => question.id === target.chosen)

  if (!chosen) return null
  const composer = () =>
    composerOf(ref.current)?.querySelector<HTMLElement>('[aria-label="Message"]') ?? null
  const clear = () => {
    composer()?.focus()
    target.onChoose(null)
  }

  return (
    <div className={clsx('mx-auto flex w-full px-1 pb-1.5', sidebar ? '' : 'max-w-[760px]')}>
      <div
        ref={ref}
        role="group"
        aria-label={t('Reply target')}
        onKeyDown={(event) => {
          // The menu renders in a portal; its own Esc only closes it.
          if (event.key !== 'Escape' || !event.currentTarget.contains(event.target as Node)) return
          event.preventDefault()
          event.stopPropagation()
          clear()
        }}
        className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-zGray-800/80 bg-zGray-900/60 py-0.5 pl-2.5 pr-1 text-[12px]"
      >
        <CornerUpLeft aria-hidden className="size-3 shrink-0 text-tertiary" strokeWidth={2.2} />
        <span className="shrink-0 text-tertiary">{t('Replying to:')}</span>
        {target.questions.length > 1 ? (
          <Menu>
            <MenuTrigger
              aria-label={t('Replying to {question}. Choose another question', {
                question: chosen.question,
              })}
              title={chosen.question}
              className="flex min-w-0 items-center gap-1 rounded-full text-secondary outline-none hover:text-main focus-visible:ring-1 focus-visible:ring-zViolet-accent"
            >
              <span className="min-w-0 truncate">{chosen.question}</span>
              <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" strokeWidth={2} />
            </MenuTrigger>
            <MenuContent
              side="top"
              align="start"
              className="max-w-[min(420px,calc(100vw-32px))]"
              finalFocus={composer}
            >
              {target.questions.map((question) => (
                <MenuItem
                  key={question.id}
                  selected={question.id === chosen.id}
                  title={question.question}
                  onClick={() => target.onChoose(question.id)}
                >
                  <span className="block truncate">{question.question}</span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : (
          <span className="min-w-0 truncate text-secondary" title={chosen.question}>
            {chosen.question}
          </span>
        )}
        <button
          type="button"
          onMouseDown={keepComposerFocus}
          onClick={clear}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-zGray-800 hover:text-main"
          title={t('Send as an ordinary message')}
          aria-label={t('Send as an ordinary message')}
        >
          <X className="size-3" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}
