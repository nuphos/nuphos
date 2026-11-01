import { Check, Loader2 } from 'lucide-react'

import { t } from '../../../i18n'
import { CloudLogo } from '../../CloudLogo'
import { LinearMark } from '../../LinearMark'
import { Button } from '../../ui/button'

import { CONNECT_ITEMS } from './connectCardItems'

import type { ConnectProvider, ConnectRowStatus } from './connectCardModel'

const ACTION_LABEL: Partial<Record<ConnectRowStatus, string>> = {
  error: t('Try again'),
  available: t('Use in agent'),
}

function ProviderLogo({ provider }: { provider: ConnectProvider }) {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-zGray-900">
      {provider === 'linear' ? (
        <LinearMark size={18} />
      ) : (
        <CloudLogo provider={provider} size={18} />
      )}
    </div>
  )
}

function RowAction({
  status,
  interactive,
  onConnect,
  onUse,
}: {
  status: ConnectRowStatus
  interactive: boolean
  onConnect: () => void
  onUse: () => void
}) {
  if (status === 'connected') {
    return (
      <span className="t-share-in inline-flex items-center gap-1 text-[12.5px] font-medium text-success">
        <Check className="t-share-pop h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
        {t('Connected')}
      </span>
    )
  }
  if (!interactive) return <span className="text-[12px] text-tertiary">{t('Not connected')}</span>
  if (status === 'choose') {
    return (
      <span className="text-[12px] text-tertiary">{t('Pick one in the credential picker')}</span>
    )
  }
  const busy = status === 'connecting'
  const label = ACTION_LABEL[status] ?? t('Connect')

  return (
    <div className="flex items-center gap-2">
      {status === 'cancelled' && (
        <span className="t-share-in text-[12px] text-tertiary">{t('Cancelled')}</span>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="h-7 min-w-[84px] px-2.5 text-[12.5px]"
        disabled={busy}
        onClick={status === 'available' ? onUse : onConnect}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label={t('Connecting')} />
        ) : (
          label
        )}
      </Button>
    </div>
  )
}

export function ConnectRow({
  provider,
  status,
  interactive,
  onConnect,
  onUse,
}: {
  provider: ConnectProvider
  status: ConnectRowStatus
  interactive: boolean
  onConnect: () => void
  onUse: () => void
}) {
  const item = CONNECT_ITEMS.get(provider)

  return (
    <li className="flex items-center gap-3 border-t border-zGray-800/60 px-4 py-2.5">
      <ProviderLogo provider={provider} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-main">{item?.name ?? provider}</div>
        {item && <div className="truncate text-[12px] text-tertiary">{item.description}</div>}
      </div>
      <RowAction
        key={status}
        status={status}
        interactive={interactive}
        onConnect={onConnect}
        onUse={onUse}
      />
    </li>
  )
}

export function ContinueFooter({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="t-share-in flex justify-end border-t border-zGray-800/60 px-4 py-2.5">
      <Button size="sm" className="h-7 px-3 text-[12.5px]" onClick={onContinue}>
        {t('Continue')}
      </Button>
    </div>
  )
}

export function ConnectHeader({
  providers,
  reason,
}: {
  providers: ConnectProvider[]
  reason: string
}) {
  const single = providers.length === 1 ? CONNECT_ITEMS.get(providers[0])?.name : undefined

  return (
    <div className="px-4 pb-2.5 pt-3.5">
      <div className="text-[13.5px] font-medium text-main">
        {single ? t('Connect {name}', { name: single }) : t('Connect apps to continue')}
      </div>
      {reason && <AgentQuote text={reason} />}
    </div>
  )
}

// The agent wrote this; quote it so it can't pass for an app message.
export function AgentQuote({ text }: { text: string }) {
  return (
    <blockquote className="mt-1.5 whitespace-pre-wrap border-l-2 border-zGray-700 pl-2 text-[12.5px] leading-snug text-secondary">
      <span className="text-tertiary">{t('Agent:')} </span>
      {text}
    </blockquote>
  )
}
