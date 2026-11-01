import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { CloudLogo } from '../../components/CloudLogo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { GOOGLE_CLIENT_GUIDE_URL } from './GoogleOAuthClientCard'
import { PERSONAL_CREDENTIALS_CHANGED, nameOf } from './personalCredentials'
import { SectionHeader } from './shared'

import type { AtlasTeam, PersonalCredential, PersonalCredentialProvider } from '../../types'

const PROVIDERS: { provider: PersonalCredentialProvider; name: string; description: string }[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: t(
      'Act as yourself on GitHub — commits, PRs and comments are authored by you instead of nuphos[bot]. Agents scoped to one repository keep using nuphos[bot].',
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
    description: t('Let the agent read, label, draft and send mail in your own inbox.'),
  },
  {
    provider: 'google-drive',
    name: 'Google Drive',
    description: t('Let the agent find, read and save files in your own Google Drive.'),
  },
]
// The login is styled, so split one sentence around it.
const CONNECTED_AS = t('Connected as {login}').split('{login}')

const isGoogle = (provider: PersonalCredentialProvider) =>
  provider === 'gmail' || provider === 'google-drive'

export function PersonalCredentialsSection({ team }: { team: AtlasTeam | undefined }) {
  const [credentials, setCredentials] = useState<PersonalCredential[] | null>(null)
  // Gmail / Google Drive go through the current team's own OAuth client.
  const [teamHasGoogleClient, setTeamHasGoogleClient] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<PersonalCredentialProvider | null>(null)
  const [disconnecting, setDisconnecting] = useState<PersonalCredentialProvider | null>(null)

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
        .then((clientId) => setTeamHasGoogleClient(Boolean(clientId)))
        .catch(() => setTeamHasGoogleClient(false))
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
      const { authorizeUrl } = await api.atlasStartPersonalCredential(
        provider,
        isGoogle(provider) ? team?.id : undefined,
      )

      await api.appOpenExternal(authorizeUrl)
    } catch (err) {
      if (parseAtlasError(err).code === 'personal_credential_not_configured') {
        toast.error(
          t('Could not connect {name}', { name: nameOf(provider) }),
          t('Not configured on this server yet'),
        )
      } else {
        toast.apiError(t('Could not connect {name}', { name: nameOf(provider) }), err)
      }
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(provider: PersonalCredentialProvider) {
    setBusy(provider)
    try {
      await api.atlasDeletePersonalCredential(provider, isGoogle(provider) ? team?.id : undefined)
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
        description={t('Connect your own accounts so the agent acts as you.')}
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
              <div className="h-[72px] rounded-lg bg-zGray-800/40" />
              <div className="h-[72px] rounded-lg bg-zGray-800/40" />
            </div>
          }
        >
          <div className="space-y-3">
            {PROVIDERS.map(({ provider, name, description }) => {
              // Gmail / Google Drive grants are per team; show this team's.
              const credential = credentials?.find(
                (c) => c.provider === provider && (!isGoogle(provider) || c.teamId === team?.id),
              )
              const needsTeamClient = isGoogle(provider) && !teamHasGoogleClient

              return (
                <div
                  key={provider}
                  className="flex items-center gap-4 rounded-lg border border-zGray-800/70 bg-surface px-4 py-3.5"
                >
                  <CloudLogo provider={provider} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-main">{name}</div>
                    <p className="mt-0.5 text-[12.5px] text-tertiary">{description}</p>
                    {!credential && needsTeamClient && (
                      <p className="mt-1.5 text-[12.5px] text-secondary">
                        {t('Needs a Google OAuth client in Team settings.')}{' '}
                        <button
                          type="button"
                          className="text-zViolet-accent hover:underline"
                          onClick={() => void api.appOpenExternal(GOOGLE_CLIENT_GUIDE_URL)}
                        >
                          {t('Setup guide')}
                        </button>
                      </p>
                    )}
                    <div className="t-collapse" data-open={Boolean(credential)}>
                      <div className="t-collapse-inner">
                        {credential && (
                          <p className="mt-1.5 text-[12.5px] text-secondary">
                            {CONNECTED_AS[0]}
                            <span className="font-medium text-main">{credential.login}</span>
                            {CONNECTED_AS[1]}
                            {credential.workspaceName && ` · ${credential.workspaceName}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {credential ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy === provider}
                      onClick={() => setDisconnecting(provider)}
                    >
                      {t('Disconnect')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === provider || needsTeamClient}
                      onClick={() => void connect(provider)}
                    >
                      {t('Connect')}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </SkeletonReveal>
      )}
      <p className="mt-4 text-[12px] text-tertiary">
        {t('Used when you send a message, and for automated runs in agents you own.')}
      </p>
      <ConfirmDialog
        open={disconnecting !== null}
        title={t('Disconnect {name}', { name: disconnecting ? nameOf(disconnecting) : '' })}
        description={
          disconnecting === 'github' || disconnecting === 'linear'
            ? t(
                'Your messages will use the team’s credentials again. The grant is also revoked at the provider.',
              )
            : t(
                'The agent will no longer have access. Google revokes the grant once neither Gmail nor Google Drive is connected.',
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
