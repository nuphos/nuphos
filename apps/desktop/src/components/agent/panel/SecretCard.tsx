import { useContext, useState } from 'react'

import { t } from '../../../i18n'
import { Button } from '../../ui/button'

import { ConnectCardContext } from './connectCardContext'
import { AgentQuote } from './ConnectCardRows'

/**
 * A secret the agent asked for: the value goes straight to a file on its
 * runtime, and only the file's path is sent as the reply.
 */
export function SecretCard({
  toolCallId,
  name,
  reason,
  canAct,
}: {
  toolCallId: string
  name: string
  reason: string
  /** The latest reply and no turn running: only then can the value be sent. */
  canAct: boolean
}) {
  const ctx = useContext(ConnectCardContext)
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sent' | 'error'>('idle')
  const interactive = Boolean(ctx?.saveSecret) && canAct && phase !== 'sent'
  const submit = async () => {
    if (!ctx?.saveSecret || !value) return
    setPhase('saving')
    try {
      const path = await ctx.saveSecret(name, value)

      setValue('')
      setPhase('sent')
      ctx.send(`🔒 ${name} saved to ${path}`, toolCallId, reason)
    } catch {
      setPhase('error')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zGray-800 bg-zGray-875">
      <div className="px-4 pb-2.5 pt-3.5">
        <div className="text-[13.5px] font-medium text-main">
          {t('Secret needed:')} <span className="font-mono">{name}</span>
        </div>
        {reason && <AgentQuote text={reason} />}
      </div>
      <div className="border-t border-zGray-800/60 px-4 py-2.5">
        {phase === 'sent' ? (
          <div className="text-[12px] text-tertiary">{t("Saved on the agent's runtime.")}</div>
        ) : (
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
              className="min-w-0 flex-1 rounded-md border border-zGray-800 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-main outline-none focus:border-zViolet-accent"
            />
            <Button type="submit" size="sm" disabled={!interactive || !value || phase === 'saving'}>
              {phase === 'saving' ? t('Saving…') : t('Send securely')}
            </Button>
          </form>
        )}
        {phase === 'error' && (
          <div className="mt-1.5 text-[12px] text-red-400">
            {t("Could not save it on the agent's runtime. Try again.")}
          </div>
        )}
        {!ctx?.saveSecret && canAct && (
          <div className="mt-1.5 text-[11.5px] text-tertiary">
            {t('Only the owner of this conversation can provide this secret.')}
          </div>
        )}
        {phase !== 'sent' && (
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
