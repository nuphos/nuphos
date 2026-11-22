import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { CloudLogo } from '../../components/CloudLogo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { INLINE_LINK } from '../../components/ui/inline-link'
import { toast } from '../../components/ui/toast'
import { useTeamRole } from '../../hooks/useTeamRole'
import { t } from '../../i18n'
import { isGoogle } from '../../types'
import { needsTeamGoogleClient } from '../settings/googleClient'
import { GOOGLE_CLIENT_GUIDE_URL } from '../settings/GoogleOAuthClientCard'
import { PersonalAccountLines } from '../settings/PersonalAccountLines'
import { MULTI_ACCOUNT_PROVIDERS, credentialsFor } from '../settings/personalAccounts'
import {
  PERSONAL_CREDENTIALS_CHANGED,
  connectPersonalCredential,
  nameOf,
} from '../settings/personalCredentials'
import { useAdminName } from '../settings/useAdminName'

import { OverflowMarquee } from './overflow-marquee'

import type { PersonalCredential, PersonalCredentialProvider, TeamGoogleClient } from '../../types'
import type { PersonalConnector } from '../settings/personalCredentials'

/** A Google account waits for the team's OAuth client: admins can add it, everyone else asks one. */
function GoogleClientHint({
  teamId,
  onOpenTeamSettings,
}: {
  teamId: string
  onOpenTeamSettings: () => void
}) {
  const role = useTeamRole(teamId)
  const isAdmin = role === 'ADMINISTRATOR'
  const admin = useAdminName(teamId, role !== undefined && !isAdmin)

  return (
    <p className="mt-1 text-[12px] text-secondary">
      {admin
        ? t('Needs a Google OAuth client. Ask {name} to add one in Team settings.', { name: admin })
        : t('Needs a Google OAuth client in Team settings.')}{' '}
      <button
        type="button"
        className={INLINE_LINK}
        onClick={() => void api.appOpenExternal(GOOGLE_CLIENT_GUIDE_URL)}
      >
        {t('Setup guide')}
      </button>
      {isAdmin && (
        <>
          {' · '}
          <button type="button" className={INLINE_LINK} onClick={onOpenTeamSettings}>
            {t('Open Team settings')}
          </button>
        </>
      )}
    </p>
  )
}

/**
 * The member's own accounts, listed beside the team's connectors so Connectors is the one place to
 * connect, see and disconnect them. GitHub and Linear keep several accounts side by side.
 */
export function PersonalConnectors({
  teamId,
  items,
  onOpenTeamSettings,
}: {
  teamId: string
  items: PersonalConnector[]
  onOpenTeamSettings: () => void
}) {
  const [credentials, setCredentials] = useState<PersonalCredential[] | null>(null)
  // Whether Google accounts can connect here; unknown (null) leaves Connect to say why if not.
  const [googleClient, setGoogleClient] = useState<TeamGoogleClient | null>(null)
  const [busy, setBusy] = useState<PersonalCredentialProvider | null>(null)
  const [disconnecting, setDisconnecting] = useState<PersonalCredential | null>(null)
  // Status only decorates the rows; if it cannot be read they still offer Connect.
  const refresh = useCallback(() => {
    void api
      .atlasListPersonalCredentials()
      .then(setCredentials)
      .catch(() => setCredentials(null))
  }, [])

  useEffect(() => {
    void api
      .atlasGetTeamGoogleClient(teamId)
      .then(setGoogleClient)
      .catch(() => setGoogleClient(null))
  }, [teamId])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener(PERSONAL_CREDENTIALS_CHANGED, refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener(PERSONAL_CREDENTIALS_CHANGED, refresh)
    }
  }, [refresh])

  async function connect(provider: PersonalCredentialProvider) {
    setBusy(provider)
    try {
      await connectPersonalCredential(provider, teamId)
    } finally {
      setBusy(null)
    }
  }

  async function disconnect({ provider, id }: PersonalCredential) {
    setBusy(provider)
    try {
      await api.atlasDeletePersonalCredential(provider, isGoogle(provider) ? teamId : undefined, id)
      toast.success(t('{name} disconnected', { name: nameOf(provider) }))
    } catch (err) {
      toast.apiError(t('Could not disconnect {name}', { name: nameOf(provider) }), err)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-line-control/55 pb-2.5">
        <h2 className="text-[13px] font-medium text-main">{t('Personal')}</h2>
        <span className="truncate text-[12px] text-tertiary">
          {t('Connect your own accounts so your Bots and tasks act as you.')}
        </span>
      </div>
      <div className="-mx-2 grid grid-cols-1 gap-x-5 gap-y-0.5 sm:grid-cols-2">
        {items.map(({ provider, summary }) => {
          const name = nameOf(provider)
          const accounts = credentialsFor(credentials, provider, teamId)
          const needsTeamClient =
            accounts.length === 0 && needsTeamGoogleClient(provider, googleClient)

          return (
            <div key={provider} className="flex min-w-0 items-start gap-3 rounded-lg px-2 py-2.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line-control/55 bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <CloudLogo provider={provider} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-main">{name}</span>
                {accounts.length === 0 ? (
                  <OverflowMarquee text={summary} className="mt-0.5 text-[12px] text-secondary" />
                ) : (
                  <PersonalAccountLines
                    accounts={accounts}
                    busy={busy === provider}
                    canAddMore={MULTI_ACCOUNT_PROVIDERS.includes(provider)}
                    onDisconnect={setDisconnecting}
                    onConnectAnother={() => void connect(provider)}
                  />
                )}
                {needsTeamClient && (
                  <GoogleClientHint teamId={teamId} onOpenTeamSettings={onOpenTeamSettings} />
                )}
              </div>
              {accounts.length === 0 && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy === provider || needsTeamClient}
                  aria-label={t('Add {name}', { name })}
                  onClick={() => void connect(provider)}
                >
                  {t('Connect')}
                </Button>
              )}
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={disconnecting !== null}
        title={t('Disconnect {name}', {
          name: disconnecting ? nameOf(disconnecting.provider) : '',
        })}
        description={
          disconnecting?.provider === 'github' || disconnecting?.provider === 'linear'
            ? t(
                '{login} is disconnected and its grant is revoked at the provider. Your other accounts stay connected. Bots and tasks that used {login} may need to pick another account.',
                { login: disconnecting.login },
              )
            : t(
                'Your Bots and tasks will no longer have access. Google revokes the grant once neither Gmail nor Google Drive is connected.',
              )
        }
        confirmLabel={t('Disconnect')}
        destructive
        onConfirm={() => (disconnecting ? disconnect(disconnecting) : undefined)}
        onClose={() => setDisconnecting(null)}
      />
    </section>
  )
}
