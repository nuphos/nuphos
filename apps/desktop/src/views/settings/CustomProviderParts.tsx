import clsx from 'clsx'
import { Check, CircleAlert, WifiOff, X } from 'lucide-react'

import { t } from '../../i18n'

import type { CustomProviderAgent, CustomProviderCheck } from '../../api'
import type { ReactNode } from 'react'

const NAMES: Record<CustomProviderAgent, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
}

const Line = ({ ok, children }: { ok: boolean; children: ReactNode }) => (
  <li className="flex gap-2">
    {ok ? (
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
    ) : (
      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" />
    )}
    <span>{children}</span>
  </li>
)

/** What the one test request found, line by line, with the request that failed. */
export function CheckResult({
  check,
  provider,
  azure,
}: {
  check: CustomProviderCheck
  provider: CustomProviderAgent
  azure: boolean
}) {
  if (!check.reached)
    return (
      <p className="flex gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning">
        <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t(
          'Couldn’t reach {host} within 10 s. You can still save; {name} will fail to start until it answers.',
          { host: check.host, name: NAMES[provider] },
        )}
      </p>
    )
  const { failure, models } = check
  const wrongApi = azure
    ? t('This resource doesn’t answer as Azure OpenAI does. Check the resource name.')
    : provider === 'codex'
      ? t(
          'Codex needs the OpenAI Responses API, which this URL doesn’t serve. Use the provider’s base URL, such as https://api.example.com/v1.',
        )
      : provider === 'opencode'
        ? t('This URL doesn’t answer as an OpenAI-compatible API does. Check the base URL.')
        : t('This URL doesn’t answer as the Anthropic API does. Check the base URL.')

  return (
    <div
      className={clsx(
        'space-y-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-main',
        failure ? 'bg-error/5' : 'bg-success/10',
      )}
    >
      <ul className="space-y-1">
        <Line ok>{t('Reached {host} in {ms} ms', { host: check.host, ms: String(check.ms) })}</Line>
        {failure?.reason === 'key' && (
          <Line ok={false}>{t('The provider turned down this key.')}</Line>
        )}
        {failure?.reason === 'api' && <Line ok={false}>{wrongApi}</Line>}
        {!failure && <Line ok>{t('Key accepted')}</Line>}
        {models && (
          <Line ok={models.answered === models.total}>
            {t('{answered} of {total} model IDs answered', {
              answered: String(models.answered),
              total: String(models.total),
            })}
          </Line>
        )}
      </ul>
      {failure && (
        <pre className="rounded-md border border-line-control bg-surface px-3 py-1.5 font-mono text-xs text-secondary select-text">
          {failure.request}
        </pre>
      )}
    </div>
  )
}

export const Alert = ({ children }: { children: ReactNode }) => (
  <p
    role="alert"
    className="flex gap-2 whitespace-pre-line rounded-lg bg-error/5 px-3 py-2.5 text-xs leading-5 text-error"
  >
    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>{children}</span>
  </p>
)

/** One field, its label above and its rule, or else its hint, below; `modal` in Field's style. */
export function Row({
  modal,
  label,
  hint,
  problem,
  div,
  children,
}: {
  modal: boolean
  label: string
  hint?: string
  problem?: string
  /** For a control a label must not wrap: a click on the label would press its button. */
  div?: boolean
  children: ReactNode
}) {
  const Tag = div ? 'div' : 'label'

  return (
    <Tag className={modal ? 'block' : 'block space-y-1.5'}>
      <span
        className={
          modal
            ? 'mb-1.5 block text-[12.5px] font-medium text-secondary'
            : 'block text-[12px] text-secondary'
        }
      >
        {label}
      </span>
      {children}
      {problem ? (
        <span className={clsx('flex items-center gap-1.5 text-xs text-error', modal && 'mt-1.5')}>
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          {problem}
        </span>
      ) : (
        hint && (
          <span className={clsx('block text-tertiary', modal ? 'mt-1.5 text-[12px]' : 'text-xs')}>
            {hint}
          </span>
        )
      )}
    </Tag>
  )
}
