import { Lock } from 'lucide-react'
import { useContext, useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { secretSavedReply } from './connectCardModel'
import { AgentQuote } from './ConnectCardRows'
import { DecisionAnswersContext } from './decisionAnswers'

import type { CardAnswerState } from './replyTarget'

/**
 * A secret the agent asked for: the value goes straight to a file on its
 * runtime, and only the file's path is sent as the reply. Once saved or
 * closed, the card is one line.
 */
export function SecretCard({
  toolCallId,
  requestId,
  name,
  reason,
  state,
}: {
  toolCallId: string
  requestId?: string
  name: string
  reason: string
  /** Whether the value can be sent now, and if not, why. */
  state: CardAnswerState
}) {
  const ctx = useContext(ConnectCardContext)
  const answered = useContext(DecisionAnswersContext).has(toolCallId)
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle')
  const interactive = Boolean(ctx?.saveSecret) && state === 'open'
  const submit = async () => {
    if (!ctx?.saveSecret || !value) return
    setPhase('saving')
    try {
      const path = await ctx.saveSecret(name, value)

      setValue('')
      setPhase('sent')
      ctx.send(`${secretSavedReply(name)}${path}`, {
        toolCallId,
        requestId,
        question: reason,
        secretName: name,
      })
    } catch {
      setPhase('error')
    }
  }

  const saved = phase === 'sent' || answered

  if (saved || state === 'closed')
    return <SecretDone toolCallId={toolCallId} name={name} saved={saved} />

  return (
    <div
      data-tool-call-id={toolCallId}
      data-decision-question={reason || undefined}
      className="overflow-hidden rounded-xl surface-raised bg-surface-raised"
    >
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-[13.5px] font-medium text-main">
          {t('Secret needed:')} <span className="font-mono">{name}</span>
        </div>
        {reason && <AgentQuote text={reason} />}
      </div>
      <div className="border-t border-line-control/60 px-4 py-2.5">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={name}
            placeholder={t('Paste the value')}
            value={value}
            disabled={!interactive || phase === 'saving'}
            onChange={(event) => setValue(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line-control bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-main outline-none focus:border-line-focus"
          />
          <Button type="submit" size="sm" disabled={!interactive || !value || phase === 'saving'}>
            {phase === 'saving' ? t('Saving…') : t('Send securely')}
          </Button>
        </form>
        {phase === 'error' && (
          <div className="mt-1.5 text-[12px] text-red-400">
            {t("Could not save it on the agent's runtime. Try again.")}
          </div>
        )}
        <SecretBlocked state={ctx?.saveSecret ? state : 'notOwner'} />
        <div className="mt-1.5 text-[11.5px] text-tertiary">
          {t(
            "The value is written to a file on the agent's runtime and never appears in this conversation.",
          )}
        </div>
      </div>
    </div>
  )
}

/** A saved or closed request: one line, no field. */
function SecretDone({
  toolCallId,
  name,
  saved,
}: {
  toolCallId: string
  name: string
  saved: boolean
}) {
  return (
    <div data-tool-call-id={toolCallId} className="text-[12px] text-tertiary">
      <Lock className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
      <span className="mr-1.5 font-mono">{name}</span>
      {saved
        ? t("Saved on the agent's runtime.")
        : t('This request is closed. Ask the agent to request the secret again.')}
    </div>
  )
}

/** Why the value can't be sent right now, and what makes it possible. */
function SecretBlocked({ state }: { state: CardAnswerState | 'notOwner' }) {
  const why = {
    open: null,
    notOwner: t('Only the owner of this conversation can provide this secret.'),
    offline: t(
      "The agent's runtime isn't reachable. Wake or reconnect the computer it runs on to send this.",
    ),
    busy: t('The agent is working. You can send this when its turn ends.'),
    // A closed request shows as one line instead.
    closed: null,
  }[state]

  return why && <div className="mt-1.5 text-[11.5px] text-tertiary">{why}</div>
}
