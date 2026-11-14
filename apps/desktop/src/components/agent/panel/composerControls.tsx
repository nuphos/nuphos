import clsx from 'clsx'
import { ArrowUp, ChevronDown, ListOrdered, Square } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'

import { isRichImageDrop } from './attachmentDrag'
import { ComposerVoice } from './ComposerVoice'
import { AGENT_QUEUE_PLACEHOLDER } from './constants'
import { usePastedTextChips } from './usePastedTextChips'
import { OpenSlackThreadButton } from './ReadOnlyNotice'

import type { ComposerVoiceScope } from './ComposerVoice'
import type { AgentSlackThread } from '../../../api'
import type {
  ClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from 'react'

export function ComposerEditor({
  hero,
  streaming,
  hasEditorContent,
  canCompleteSuggestion,
  displayedPlaceholder,
  placeholderRef,
  editorRef,
  onInput,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
}: {
  hero: boolean
  streaming: boolean
  hasEditorContent: boolean
  canCompleteSuggestion: boolean
  displayedPlaceholder: string
  placeholderRef: RefObject<HTMLSpanElement | null>
  editorRef: RefObject<HTMLDivElement | null>
  onInput: () => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  onPaste: (e: ClipboardEvent<HTMLDivElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
}) {
  const pastes = usePastedTextChips()

  return (
    <div className="relative">
      {pastes.dialog}
      {!hasEditorContent && (
        <div className="pointer-events-none absolute left-0 top-0 z-0 flex max-w-full items-baseline gap-2">
          <span
            ref={placeholderRef}
            aria-hidden
            className={clsx(
              't-text-swap min-w-0 truncate leading-relaxed',
              // Lighter than the rest of the tertiary text: at 16px the
              // suggestion was heavy enough to read as something the user
              // had already typed.
              hero ? 'text-[16px] text-tertiary/60' : 'text-[14.5px] text-tertiary',
            )}
          >
            {streaming ? AGENT_QUEUE_PLACEHOLDER : displayedPlaceholder}
          </span>
          {canCompleteSuggestion && (
            // Trails the suggestion so it reads as an instruction about
            // that sentence. The key cap carries it alone — spelling out
            // "to use" competed with the sentence it annotates — and
            // prints both the glyph and the word, the way the key itself
            // does, so neither has to be recognised on its own.
            <kbd
              title={t('Press Tab to use this suggestion')}
              className="flex flex-shrink-0 items-center gap-1 rounded border border-line-control px-1 py-px font-sans text-[10px] leading-4 text-tertiary/60"
            >
              <span className="text-[11px] leading-none">⇥</span>
              Tab
            </kbd>
          )}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onClick={pastes.onClick}
        onDrop={(e) => {
          if (isRichImageDrop(e.dataTransfer)) e.preventDefault()
        }}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        aria-placeholder={streaming ? AGENT_QUEUE_PLACEHOLDER : displayedPlaceholder}
        data-placeholder=""
        className={clsx(
          'atlas-composer relative z-10 w-full bg-transparent outline-none text-main max-h-48 overflow-auto leading-relaxed scrollbar-thin',
          hero ? 'text-[16px] min-h-[52px]' : 'text-[14.5px] min-h-[36px]',
        )}
      />
    </div>
  )
}

function SendControls({
  hero,
  readOnly,
  runtimeCanCancel = false,
  canSteer = false,
  slackThread,
  hasQueueablePayload,
  sendDisabled,
  sendBlockedReason,
  onConnectAgent,
  onSubmit,
  onQueue,
  onStop,
}: {
  hero: boolean
  readOnly: boolean
  runtimeCanCancel?: boolean
  canSteer?: boolean
  executing?: boolean
  slackThread?: AgentSlackThread | null
  hasQueueablePayload: boolean
  sendDisabled: boolean
  /** Shown on the disabled button: why this message cannot go. */
  sendBlockedReason?: string | null
  /** Takes the send button's place while no agent can run. */
  onConnectAgent?: () => void
  onSubmit: () => void
  onQueue?: () => void
  onStop: () => void
}) {
  if (readOnly && slackThread) {
    return <OpenSlackThreadButton thread={slackThread} />
  }
  if (runtimeCanCancel && !readOnly) {
    return (
      <div className="flex items-center gap-1.5">
        {!sendDisabled && hasQueueablePayload && (
          <button
            onClick={onSubmit}
            className={clsx(
              hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
              'bg-action-primary hover:bg-action-primary/90 text-inverse flex items-center justify-center transition-colors',
            )}
            title={canSteer ? t('Send into the running turn') : t('Send response')}
          >
            <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
          </button>
        )}
        {canSteer && !sendDisabled && hasQueueablePayload && onQueue && (
          <Menu>
            <MenuTrigger
              className="flex h-7 w-5 items-center justify-center rounded-md text-secondary hover:bg-state-hover"
              aria-label={t('Send options')}
              title={t('Send options')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </MenuTrigger>
            <MenuContent side="top" align="end">
              <MenuItem icon={<ArrowUp className="h-4 w-4" />} onClick={onSubmit}>
                {t('Send into the running turn')}
              </MenuItem>
              <MenuItem icon={<ListOrdered className="h-4 w-4" />} onClick={onQueue}>
                {t('Queue after this turn')}
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
        <button
          onClick={onStop}
          className={clsx(
            hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
            'bg-surface-sunken hover:bg-state-hover text-main flex items-center justify-center transition-colors',
          )}
          title={t('Stop')}
        >
          <Square className="w-3 h-3 fill-current" strokeWidth={2.2} />
        </button>
      </div>
    )
  }

  if (onConnectAgent && !readOnly) {
    return (
      <Button size="sm" onClick={onConnectAgent} className={hero ? 'rounded-full' : undefined}>
        {t('Connect your agent')}
      </Button>
    )
  }

  return (
    // A disabled button gets no hover, so the reason sits on its wrapper.
    <span className="inline-flex" title={sendBlockedReason ?? undefined}>
      <button
        onClick={onSubmit}
        disabled={sendDisabled}
        aria-label={
          sendBlockedReason ? t('Send ({reason})', { reason: sendBlockedReason }) : t('Send')
        }
        className={clsx(
          hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
          'flex items-center justify-center transition-colors',
          sendDisabled
            ? 'text-tertiary'
            : 'bg-action-primary hover:bg-action-primary/90 text-inverse',
        )}
        title={sendBlockedReason ? undefined : t('Send')}
      >
        <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
      </button>
    </span>
  )
}

/**
 * The toolbar's left controls on one row. A control that does not fit wraps whole onto a second line the
 * row never shows, and is made inert there so keyboard focus cannot land on it or scroll it into view; a menu
 * it had open closes. A `data-keep` control outranks those before it: they leave, nearest first, until it fits.
 */
export function ComposerTools({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const row = ref.current

    if (!row) return
    const update = () => {
      // An open menu adds focus guards and a portal anchor to the row; only the controls count.
      const controls = [...row.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && !child.matches('[data-base-ui-focus-guard], [aria-owns]'),
      )
      const keep = controls.find((control) => control.matches('[data-keep]'))
      const before = keep ? controls.slice(0, controls.indexOf(keep)) : []

      for (const control of before) control.style.display = ''
      const first = controls[0]

      if (!first) return
      // Controls on the first line differ in height by a few pixels; the hidden line starts a full row lower.
      const nextLine = first.offsetTop + first.offsetHeight

      for (const control of before.toReversed())
        if (keep && keep.offsetTop >= nextLine) control.style.display = 'none'
      for (const control of controls) control.inert = control.offsetTop >= nextLine
      // A menu whose trigger just dropped out has nothing to anchor to or return focus to.
      if (
        controls.some(
          (control) =>
            (control.inert || !control.offsetParent) &&
            (control.matches('[data-popup-open]') || control.querySelector('[data-popup-open]')),
        )
      )
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    const observer = new ResizeObserver(update)

    observer.observe(row)
    for (const child of row.children) observer.observe(child)
    update()

    return () => observer.disconnect()
  })

  return (
    <div
      ref={ref}
      className="-my-3 flex h-14 min-w-16 flex-auto flex-wrap content-start items-center gap-x-0.5 gap-y-6 overflow-hidden py-3 @[320px]:gap-x-1"
    >
      {children}
    </div>
  )
}

/** The send controls, with the voice-input button before them while the composer can be edited. */
export function ComposerSendControls({
  voice,
  ...props
}: Parameters<typeof SendControls>[0] & { voice?: ComposerVoiceScope }) {
  if (!voice || props.readOnly) return <SendControls {...props} />

  return (
    <div className="flex items-center gap-1">
      <ComposerVoice {...voice} hero={props.hero} />
      <SendControls {...props} />
    </div>
  )
}
