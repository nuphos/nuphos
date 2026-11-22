import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { api, decideErrorToast } from '../../../api'
import { t } from '../../../i18n'
import { setChatInstructions } from '../../sidebar/agentSessions'
import { Button } from '../../ui/button'
import { IconButton } from '../../ui/icon-button'
import { MessageResponse } from '../MessageResponse'

import { SummarySection } from './ChatSummaryRows'

import type { AgentConversation } from '../../../api/agent-types'

const textClass = 'whitespace-pre-wrap break-words text-[13px] leading-5 text-main'

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
                minHeight: Math.max(120, textRef.current?.offsetHeight ?? 0),
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
        <div
          ref={textRef}
          className="min-w-0 max-w-full max-h-80 overflow-y-auto overflow-x-hidden"
        >
          {instructions ? (
            <MessageResponse
              teamId={teamId}
              disableRawHtml
              className="!text-[13px] [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_a]:break-all"
            >
              {instructions}
            </MessageResponse>
          ) : (
            <span className="text-tertiary">{t('None yet')}</span>
          )}
        </div>
      )}
    </SummarySection>
  )
}
