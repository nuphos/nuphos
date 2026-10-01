import clsx from 'clsx'
import { ArrowUp, Square } from 'lucide-react'

import { AGENT_QUEUE_PLACEHOLDER } from './constants'
import { OpenSlackThreadButton } from './ReadOnlyNotice'

import type { AgentSlackThread } from '../../../api'
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

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
  return (
    <div className="relative">
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
              title="Press Tab to use this suggestion"
              className="flex flex-shrink-0 items-center gap-1 rounded border border-zGray-700 px-1 py-px font-sans text-[10px] leading-4 text-tertiary/60"
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

export function ComposerSendControls({
  hero,
  readOnly,
  runtimeCanCancel = false,
  slackThread,
  hasQueueablePayload,
  sendDisabled,
  onSubmit,
  onStop,
}: {
  hero: boolean
  readOnly: boolean
  streaming: boolean
  runtimeCanCancel?: boolean
  executing?: boolean
  slackThread?: AgentSlackThread | null
  hasQueueablePayload: boolean
  sendDisabled: boolean
  onSubmit: () => void
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
              'bg-zViolet-500 hover:bg-zViolet-400 text-white flex items-center justify-center transition-colors',
            )}
            title="Send response"
          >
            <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
          </button>
        )}
        <button
          onClick={onStop}
          className={clsx(
            hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
            'bg-zGray-800 hover:bg-zGray-700 text-main flex items-center justify-center transition-colors',
          )}
          title="Stop agent"
        >
          <Square className="w-3 h-3 fill-current" strokeWidth={2.2} />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={onSubmit}
      disabled={sendDisabled}
      className={clsx(
        hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md',
        'flex items-center justify-center transition-colors',
        sendDisabled ? 'text-tertiary' : 'bg-zViolet-500 hover:bg-zViolet-400 text-white',
      )}
      title="Send"
    >
      <ArrowUp className="w-4 h-4" strokeWidth={2.4} />
    </button>
  )
}
