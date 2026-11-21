import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { CloudLogo } from '../../components/CloudLogo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { INLINE_LINK } from '../../components/ui/inline-link'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { isGoogle } from '../../types'

import { GOOGLE_CLIENT_GUIDE_URL } from './GoogleOAuthClientCard'
import { PersonalAccountLines } from './PersonalAccountLines'
import { MULTI_ACCOUNT_PROVIDERS, credentialsFor } from './personalAccounts'
import { needsTeamGoogleClient } from './personalConnectorOpens'
import {
  PERSONAL_CREDENTIALS_CHANGED,
  connectPersonalCredential,
  nameOf,
} from './personalCredentials'
import { TEAM_SETTINGS_DEFAULT_SECTION } from './settingsNav'
import { SectionHeader } from './shared'
import { useAdminName } from './useAdminName'

import type {
  AtlasTeam,
  PersonalCredential,
  PersonalCredentialProvider,
  TeamGoogleClient,
} from '../../types'

const PROVIDERS: { provider: PersonalCredentialProvider; name: string; description: string }[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: t(
      'Act as yourself on GitHub — commits, PRs and comments are authored by you instead of nuphos[bot]. Tasks scoped to one repository keep using nuphos[bot].',
    ),
  },
  {
    provider: 'linear',
    name: 'Linear',
    description: t(
      'Linear issues and comments are authored by you instead of the team’s Linear app.',
    ),
  },
  {
    provider: 'gmail',
    name: 'Gmail',
    description: t('Let your Bots and tasks read, label, draft and send mail in your own inbox.'),
  },
  {
    provider: 'google-drive',
    name: 'Google Drive',
    description: t('Let your Bots and tasks find, read and save files in your own Google Drive.'),
  },
  {
    provider: 'google-calendar',
    name: 'Google Calendar',
    description: t(
      'Let your Bots and tasks check your schedule and create or update events in your own Google Calendar.',
    ),
  },
]

export function PersonalCredentialsSection({
  team,
  onOpenSection,
}: {
  team: AtlasTeam | undefined
  /** Switch Settings to another section, e.g. Team settings for the Google OAuth client. */
  onOpenSection?: (section: string) => void
}) {
  const [credentials, setCredentials] = useState<PersonalCredential[] | null>(null)
  // Gmail / Google Drive / Google Calendar go through the team's own OAuth client, else Composio.
  // Null while unknown, or when it could not be read: Connect stays available and says why if it fails.
  const [googleClient, setGoogleClient] = useState<TeamGoogleClient | null>(null)
  const admin = useAdminName(team?.id, Boolean(team && team.role !== 'ADMINISTRATOR'))
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<PersonalCredentialProvider | null>(null)
  const [disconnecting, setDisconnecting] = useState<PersonalCredential | null>(null)

  const refresh = useCallback(() => {
    void api
      .atlasListPersonalCredentials()
      .then((list) => {
        setCredentials(list)
        setLoadFailed(false)
      })
      .catch((err: unknown) => {
        setLoadFailed(true)
        toast.apiError(t('Could not load Personal Credentials'), err)
      })
    if (team) {
      void api
        .atlasGetTeamGoogleClient(team.id)
        .then(setGoogleClient)
        .catch(() => setGoogleClient(null))
    }
  }, [team])

  // Refetch after a claimed deep link, and on focus as a fallback.
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
      await connectPersonalCredential(provider, team?.id)
    } finally {
      setBusy(null)
    }
  }

  async function disconnect({ provider, id }: PersonalCredential) {
    setBusy(provider)
    try {
      await api.atlasDeletePersonalCredential(
        provider,
        isGoogle(provider) ? team?.id : undefined,
        id,
      )
      toast.success(t('{name} disconnected', { name: nameOf(provider) }))
    } catch (err) {
      toast.apiError(t('Could not disconnect {name}', { name: nameOf(provider) }), err)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  return (
    <div>
      <SectionHeader
        title={t('Personal Credentials')}
        description={t('Connect your own accounts so your Bots and tasks act as you.')}
      />
      {!credentials && loadFailed && (
        <p className="text-[12.5px] text-tertiary">
          {t('Couldn’t load your Personal Credentials.')}{' '}
          <Button type="button" size="sm" variant="secondary" onClick={refresh}>
            {t('Retry')}
          </Button>
        </p>
      )}
      {(credentials || !loadFailed) && (
        <SkeletonReveal
          ready={Boolean(credentials)}
          skeleton={
            <div aria-busy="true" className="space-y-3">
              <div className="h-[72px] rounded-lg bg-state-selected" />
              <div className="h-[72px] rounded-lg bg-state-selected" />
            </div>
          }
        >
          <div className="space-y-3">
            {PROVIDERS.map(({ provider, name, description }) => {
              const accounts = credentialsFor(credentials, provider, team?.id)
              const credential = accounts[0]
              const needsTeamClient = needsTeamGoogleClient(provider, googleClient)
              const viaComposio =
                isGoogle(provider) && googleClient?.clientId === null && googleClient.composio

              return (
                <div
                  key={provider}
                  className="flex items-center gap-4 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5"
                >
                  <CloudLogo provider={provider} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-main">{name}</div>
                    <p className="mt-0.5 text-[12.5px] text-tertiary">{description}</p>
                    {!credential && viaComposio && (
                      <p className="mt-1.5 text-[12.5px] text-secondary">
                        {t('Connects through Composio, which handles this data for Nuphos.')}
                      </p>
                    )}
                    {!credential && needsTeamClient && (
                      <p className="mt-1.5 text-[12.5px] text-secondary">
                        {admin
                          ? t(
                              'Needs a Google OAuth client. Ask {name} to add one in Team settings.',
                              {
                                name: admin,
                              },
                            )
                          : t('Needs a Google OAuth client in Team settings.')}{' '}
                        <button
                          type="button"
                          className={INLINE_LINK}
                          onClick={() => void api.appOpenExternal(GOOGLE_CLIENT_GUIDE_URL)}
                        >
                          {t('Setup guide')}
                        </button>
                        {/* Only admins can add the client; everyone else is told whom to ask. */}
                        {team?.role === 'ADMINISTRATOR' && onOpenSection && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className={INLINE_LINK}
                              onClick={() => onOpenSection(TEAM_SETTINGS_DEFAULT_SECTION)}
                            >
                              {t('Open Team settings')}
                            </button>
                          </>
                        )}
                      </p>
                    )}
                    <PersonalAccountLines
                      accounts={accounts}
                      busy={busy === provider}
                      canAddMore={MULTI_ACCOUNT_PROVIDERS.includes(provider)}
                      onDisconnect={setDisconnecting}
                      onConnectAnother={() => void connect(provider)}
                    />
                  </div>
                  {accounts.length === 1 && credential ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy === provider}
                      onClick={() => setDisconnecting(credential)}
                    >
                      {t('Disconnect')}
                    </Button>
                  ) : accounts.length === 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === provider || needsTeamClient}
                      onClick={() => void connect(provider)}
                    >
                      {t('Connect')}
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </SkeletonReveal>
      )}
      <p className="mt-4 text-[12px] text-tertiary">
        {t('Used when you send a message, and for automated runs in Bots and tasks you own.')}
      </p>
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
    </div>
  )
}
