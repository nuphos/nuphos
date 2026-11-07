import { useContext, useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'

import type { CardAnswerState } from './replyTarget'
import { secretSaveFailure } from './secretCardModel'

/**
 * A secret the agent asked for: the value goes straight to a file on its
 * runtime, and only the file's path is sent as the reply.
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
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sent' | 'outdated' | 'error'>('idle')
  const interactive = Boolean(ctx?.saveSecret) && state === 'open' && phase !== 'sent'
  const submit = async () => {
    if (!ctx?.saveSecret || !value) return
    setPhase('saving')
    try {
      const path = await ctx.saveSecret(name, value)

      setValue('')
      setPhase('sent')
      ctx.send(`🔒 ${name} saved to ${path}`, {
        toolCallId,
        requestId,
        question: reason,
        secretName: name,
      })
    } catch (error) {
      setPhase(secretSaveFailure(error))
    }
  }
  // A runtime too old for an inline value refuses it by design: the card names
  // the update instead of a retry that would fail the same way.
  const settled = phase === 'sent' || phase === 'outdated'

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
        {phase === 'sent' && (
          <div className="text-[12px] text-tertiary">{t("Saved on the agent's runtime.")}</div>
        )}
        {phase === 'outdated' && (
          <div className="mt-1.5 text-[12px] text-status-warning">
            {t(
              'The computer running this agent needs a newer Nuphos Desktop to save a secret. Update Nuphos Desktop there, then ask the agent again.',
            )}
          </div>
        )}
        {!settled && (
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
        )}
        {phase === 'error' && (
          <div className="mt-1.5 text-[12px] text-status-danger">
            {t("Could not save it on the agent's runtime. Try again.")}
          </div>
        )}
        {!settled && <SecretBlocked state={ctx?.saveSecret ? state : 'notOwner'} />}
        {!settled && (
          <div className="mt-1.5 text-[11.5px] text-tertiary">
            {t(
              "The value is written to a file on the agent's runtime and never appears in this conversation.",
            )}
          </div>
        )}
      </div>
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
    closed: t('This request is closed. Ask the agent to request the secret again.'),
  }[state]

  return why && <div className="mt-1.5 text-[11.5px] text-tertiary">{why}</div>
}
