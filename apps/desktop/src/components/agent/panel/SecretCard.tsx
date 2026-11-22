import { Lock, X } from 'lucide-react'
import { useContext, useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { secretFieldsSavedReply, secretSavedReply } from './connectCardModel'
import { AgentQuote } from './ConnectCardRows'
import { DecisionAnswersContext } from './decisionAnswers'
import { secretSaveFailure } from './secretCardModel'

import type { CardAnswerState } from './replyTarget'
import type { SecretField } from './secretCardModel'

/**
 * A secret the agent asked for: the value goes straight to a file on its
 * runtime, and only the file's path is sent as the reply. With `fields` it
 * asks for a website form's details together, one file each, and names the
 * site they are entered on. Dismiss declines it instead: the agent is told no
 * value is coming, and nothing is sent. Once saved, dismissed or closed, the
 * card is one line.
 */
export function SecretCard({
  toolCallId,
  requestId,
  name,
  reason,
  fields,
  site,
  state,
}: {
  toolCallId: string
  requestId?: string
  name: string
  reason: string
  /** The details asked for together, and the site they are entered on. */
  fields?: SecretField[]
  site?: string
  /** Whether the value can be sent now, and if not, why. */
  state: CardAnswerState
}) {
  const ctx = useContext(ConnectCardContext)
  const answered = useContext(DecisionAnswersContext).has(toolCallId)
  // One value per field; a single secret is the only one.
  const [values, setValues] = useState<string[]>(() => (fields ?? [name]).map(() => ''))
  const [revealed, setRevealed] = useState(false)
  const value = values[0] ?? ''
  const setValue = (next: string, index = 0) =>
    setValues((current) => current.map((old, at) => (at === index ? next : old)))
  const complete = values.every(Boolean)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sent' | 'outdated' | 'error'>('idle')
  const interactive = Boolean(ctx?.saveSecret) && state === 'open'
  const [dismissed, setDismissed] = useState<'no' | 'sending' | 'yes'>('no')
  const submit = async () => {
    if (!ctx?.saveSecret || !complete || dismissed !== 'no') return
    setPhase('saving')
    try {
      // One after another: a failure leaves nothing sent, and a retry writes every field again.
      const saved: { name: string; path: string }[] = []

      for (const [index, field] of (fields ?? [{ name }]).entries())
        saved.push({
          name: field.name,
          path: await ctx.saveSecret(field.name, values[index] ?? ''),
        })
      setValues((current) => current.map(() => ''))
      setPhase('sent')
      ctx.send(
        fields
          ? secretFieldsSavedReply(name, saved)
          : `${secretSavedReply(name)}${saved[0]?.path ?? ''}`,
        {
          toolCallId,
          requestId,
          question: reason,
          secretName: name,
        },
      )
    } catch (error) {
      setPhase(secretSaveFailure(error))
    }
  }
  const saved = phase === 'sent' || answered

  if (dismissed === 'yes')
    return (
      <div data-tool-call-id={toolCallId} className="text-[12px] text-tertiary">
        {t('Dismissed. It carries on without an answer.')}
      </div>
    )
  if (saved || state === 'closed')
    return <SecretDone toolCallId={toolCallId} name={fields && site ? site : name} saved={saved} />
  // A runtime too old for an inline value refuses it by design: the card names
  // the update instead of a retry that would fail the same way.
  const outdated = phase === 'outdated'

  return (
    <div
      data-tool-call-id={toolCallId}
      data-decision-question={reason || undefined}
      className="overflow-hidden rounded-xl surface-raised bg-surface-raised"
    >
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-[13.5px] font-medium text-main">
          {fields && site ? (
            t('Details needed for {site}', { site })
          ) : (
            <>
              {t('Secret needed:')} <span className="font-mono">{name}</span>
            </>
          )}
        </div>
        {reason && <AgentQuote text={reason} />}
      </div>
      <div className="border-t border-line-control/60 px-4 py-2.5">
        {phase === 'outdated' && (
          <div className="mt-1.5 text-[12px] text-status-warning">
            {t(
              'The computer running this task needs a newer Nuphos Desktop to save a secret. Update Nuphos Desktop there, then ask again.',
            )}
          </div>
        )}
        {!outdated && fields && (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {fields.map((field, index) => (
              <label key={field.name} className="flex flex-col gap-1">
                <span className="text-[12.5px] text-secondary">{field.label}</span>
                <input
                  type={revealed ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={values[index] ?? ''}
                  disabled={!interactive || phase === 'saving'}
                  onChange={(event) => setValue(event.target.value, index)}
                  className="min-w-0 rounded-md border border-line-control bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-main outline-none focus:border-line-focus"
                />
              </label>
            ))}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-pressed={revealed}
                onClick={() => setRevealed((shown) => !shown)}
                className="text-[12px] text-tertiary hover:text-secondary"
              >
                {revealed ? t('Hide values') : t('Reveal values')}
              </button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  !interactive || !complete || phase === 'saving' || dismissed === 'sending'
                }
              >
                {phase === 'saving' ? t('Saving…') : t('Send securely')}
              </Button>
            </div>
          </form>
        )}
        {!outdated && !fields && (
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
            <Button
              type="submit"
              size="sm"
              disabled={!interactive || !value || phase === 'saving' || dismissed === 'sending'}
            >
              {phase === 'saving' ? t('Saving…') : t('Send securely')}
            </Button>
          </form>
        )}
        {phase === 'error' && (
          <div className="mt-1.5 text-[12px] text-status-danger">
            {t('Could not save it on the runtime. Try again.')}
          </div>
        )}
        {!outdated && <SecretBlocked state={ctx?.saveSecret ? state : 'notOwner'} />}
        {/* Declining is an answer anyone who may answer here can give, as on a question card. */}
        {ctx?.answer && ctx.dismiss && (
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            disabled={dismissed === 'sending' || phase === 'saving'}
            onClick={() => {
              setDismissed('sending')
              void ctx
                .dismiss?.({ toolCallId, requestId, question: reason, secretName: name })
                .then((ok) => setDismissed(ok ? 'yes' : 'no'))
            }}
          >
            <X aria-hidden className="size-3.5" />
            {t('Dismiss')}
          </Button>
        )}
        {!outdated && (
          <div className="mt-1.5 text-[11.5px] text-tertiary">
            {fields && site
              ? t(
                  'The values are written to files on the runtime and entered on {site} without passing through this conversation.',
                  { site },
                )
              : t(
                  'The value is written to a file on the runtime and never appears in this conversation.',
                )}
          </div>
        )}
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
        ? t('Saved on the runtime.')
        : t('This request is closed. Ask for the secret again in the chat.')}
    </div>
  )
}

/** Why the value can't be sent right now, and what makes it possible. */
function SecretBlocked({ state }: { state: CardAnswerState | 'notOwner' }) {
  const why = {
    open: null,
    notOwner: t('Only the owner of this conversation can provide this secret.'),
    offline: t(
      "The runtime isn't reachable. Wake or reconnect the computer it runs on to send this.",
    ),
    busy: t('Still working. You can send this when the turn ends.'),
    // A closed request shows as one line instead.
    closed: null,
  }[state]

  return why && <div className="mt-1.5 text-[11.5px] text-tertiary">{why}</div>
}
