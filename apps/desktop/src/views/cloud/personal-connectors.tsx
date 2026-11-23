import clsx from 'clsx'

import { CloudLogo } from '../../components/CloudLogo'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import { needsTeamGoogleClient } from '../settings/googleClient'
import { credentialsFor } from '../settings/personalAccounts'
import { connectPersonalCredential, nameOf } from '../settings/personalCredentials'

import { CONNECTOR_HOVER } from './connector-actions'
import { OverflowMarquee } from './overflow-marquee'
import { usePersonalCredentials } from './use-personal-credentials'

import type { PersonalConnector } from '../settings/personalCredentials'

/**
 * The member's own accounts, listed beside the team's connectors so Connectors is the one place
 * to find every integration. Connect signs in to the account in place; a connected one, or a
 * Google one still waiting for the team's OAuth client, opens its service detail.
 */
export function PersonalConnectors({
  teamId,
  items,
  onOpenAccount,
  connectedOnly = false,
  hideHeading = false,
}: {
  teamId: string
  items: PersonalConnector[]
  onOpenAccount: (provider: PersonalConnector['provider']) => void
  connectedOnly?: boolean
  hideHeading?: boolean
}) {
  const { credentials, googleClient } = usePersonalCredentials(teamId)

  return (
    <section>
      {!hideHeading && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-line-control/55 pb-2.5">
          <h2 className="text-[13px] font-medium text-main">{t('Personal')}</h2>
          <span className="truncate text-[12px] text-tertiary">
            {t('Connect your own accounts so your Bots and tasks act as you.')}
          </span>
        </div>
      )}
      <div className="-mx-2 grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
        {items
          .filter(
            ({ provider }) =>
              !connectedOnly || credentialsFor(credentials, provider, teamId).length > 0,
          )
          .map(({ provider, summary }) => {
            const name = nameOf(provider)
            const accounts = credentialsFor(credentials, provider, teamId)
            const connected = accounts.length > 0
            const opensDetail = connected || needsTeamGoogleClient(provider, googleClient)

            return (
              <div
                key={provider}
                onClick={
                  opensDetail
                    ? () => onOpenAccount(provider)
                    : () => void connectPersonalCredential(provider, teamId)
                }
                className={clsx(
                  'group flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5',
                  CONNECTOR_HOVER,
                )}
              >
                <button
                  type="button"
                  aria-label={connected ? t('Open {name}', { name }) : t('Add {name}', { name })}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:shadow-none focus-visible:!outline-none"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line-control/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                    <CloudLogo provider={provider} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-main">
                      {name}
                    </span>
                    {connected ? (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-secondary">
                        <Tooltip content={t('Connected')}>
                          <span className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
                        </Tooltip>
                        <span className="sr-only">{t('Connected:')} </span>
                        <OverflowMarquee
                          text={`${t('Only me')} · ${t('Connected as {login}', {
                            login: accounts.map(({ login }) => login).join(', '),
                          })}`}
                          className="min-w-0"
                        />
                      </span>
                    ) : (
                      <OverflowMarquee
                        text={summary}
                        className="mt-0.5 text-[12px] text-secondary"
                      />
                    )}
                  </span>
                </button>
                <span className="flex h-7 w-[76px] flex-none items-center justify-center rounded-lg border border-line-control bg-surface-sheet text-[12px] font-medium text-secondary transition-colors group-hover:border-line-control group-hover:text-main">
                  {connected ? t('Manage') : t('Connect')}
                </span>
              </div>
            )
          })}
      </div>
    </section>
  )
}
