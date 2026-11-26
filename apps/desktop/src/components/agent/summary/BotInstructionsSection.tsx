import { useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { ChevronDown, Loader2, Pencil } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { api, decideErrorToast } from '../../../api'
import { t } from '../../../i18n'
import { setChatInstructions } from '../../sidebar/agentSessions'
import { Button } from '../../ui/button'
import { IconButton } from '../../ui/icon-button'
import { MessageResponse } from '../MessageResponse'

import { SummarySection } from './ChatSummaryRows'

import type { AgentConversation } from '../../../api/agent-types'
import type { RefObject } from 'react'

const textClass = 'whitespace-pre-wrap break-words text-[13px] leading-5 text-main'

/**
 * Long instructions show their first lines and open in place under a "Show more": the panel
 * scrolls, the text does not, so there is never a second scrollbar inside it.
 */
function ClampedInstructions({
  ref,
  teamId,
  instructions,
}: {
  ref: RefObject<HTMLDivElement | null>
  teamId: string
  instructions: string
}) {
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const clipped = overflows && !expanded

  useLayoutEffect(() => {
    const el = ref.current

    if (!el || expanded) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)

    measure()
    // Markdown and fonts settle after the first paint, and the panel's width can change.
    const observer = new ResizeObserver(measure)

    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)

    return () => observer.disconnect()
  }, [ref, instructions, expanded])

  return (
    <div className="flex flex-col gap-2">
      {/* Keyboard users open it with the button below. */}
      <div
        ref={ref}
        onClick={clipped ? () => setExpanded(true) : undefined}
        className={clsx(
          'min-w-0 max-w-full overflow-hidden',
          !expanded && 'max-h-40',
          clipped &&
            'cursor-pointer [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]',
        )}
      >
        {instructions ? (
          <MessageResponse
            teamId={teamId}
            disableRawHtml
            className="!text-[13px] [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto"
          >
            {instructions}
          </MessageResponse>
        ) : (
          <span className="text-tertiary">{t('None yet')}</span>
        )}
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="flex h-7 items-center justify-center gap-1 rounded-lg bg-state-hover text-[12.5px] font-medium text-main outline-none hover:bg-state-selected focus-visible:ring-2 focus-visible:ring-line-focus"
        >
          {expanded ? t('Show less') : t('Show more')}
          <ChevronDown aria-hidden className={clsx('size-3.5', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}

/**
 * A Bot's standing instructions in full, which its transcript only shows clipped. Its owner
 * rewrites them here, in place.
 */
export function BotInstructionsSection({
  conversation,
  teamId,
}: {
  conversation?: AgentConversation
  teamId: string
}) {
  const client = useQueryClient()
  const textRef = useRef<HTMLDivElement>(null)
  // The text being edited, and the height it opens at: the text's own, so nothing jumps.
  const [draft, setDraft] = useState<{ text: string; minHeight: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!conversation?.avatar) return null
  const { sessionId } = conversation
  const instructions = conversation.instructions ?? ''
  const cancel = () => {
    setDraft(null)
    setError(null)
  }

  async function save(text: string) {
    if (text === instructions || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.agentSetBotInstructions(sessionId, text, teamId)

      await setChatInstructions(client, teamId, sessionId, saved.instructions)
      setDraft(null)
    } catch (err) {
      const decision = decideErrorToast(err)

      setError(
        (decision.action === 'show' && decision.description) ||
          t('The change was not saved — please try again.'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <SummarySection
      title={t('Bot instructions')}
      action={
        conversation.isOwner &&
        !draft && (
          <IconButton
            label={t('Edit instructions')}
            icon={<Pencil />}
            onClick={() =>
              setDraft({
                text: instructions,
                minHeight: Math.max(120, textRef.current?.scrollHeight ?? 0),
              })
            }
          />
        )
      }
    >
      {draft ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save(draft.text)
          }}
        >
          <textarea
            autoFocus
            value={draft.text}
            aria-label={t('Bot instructions')}
            placeholder={t('Tell this Bot how to work…')}
            style={{ minHeight: Math.min(draft.minHeight, 320) }}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                event.preventDefault()
                cancel()
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void save(draft.text)
              }
            }}
            className={`${textClass} max-h-80 w-full resize-none overflow-y-auto rounded-md border border-line-control bg-transparent px-2 py-1.5 outline-none [field-sizing:content] focus-visible:border-line-focus`}
          />
          {error && <p className="text-[12px] leading-4 text-error">{error}</p>}
          <div className="flex justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={draft.text === instructions || saving}>
              {saving && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              {t('Save')}
            </Button>
          </div>
        </form>
      ) : (
        <ClampedInstructions ref={textRef} teamId={teamId} instructions={instructions} />
      )}
    </SummarySection>
  )
}
