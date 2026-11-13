import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { CloudLogo } from '../../components/CloudLogo'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { INLINE_LINK } from '../../components/ui/inline-link'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import {
  personalCredentialsChanged,
  usePersonalCredentialsQuery,
  useTeamGoogleClientQuery,
} from '../../lib/query/account'

import { GOOGLE_CLIENT_GUIDE_URL } from './GoogleOAuthClientCard'
import { credentialFor, isGoogle, nameOf } from './personalCredentials'
import { TEAM_SETTINGS_DEFAULT_SECTION } from './settingsNav'
import { SectionHeader } from './shared'
import { useAdminName } from './useAdminName'

import type { AtlasTeam, PersonalCredentialProvider } from '../../types'

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

export function PersonalCredentialsSection({
  team,
  onOpenSection,
}: {
  team: AtlasTeam | undefined
  /** Switch Settings to another section, e.g. Team settings for the Google OAuth client. */
  onOpenSection?: (section: string) => void
}) {
  const listed = usePersonalCredentialsQuery()
  const credentials = listed.data ?? null
  const loadFailed = listed.isError
  // Gmail / Google Drive go through the current team's own OAuth client, else Nuphos's Composio.
  // Unknown while loading or when it could not be read: Connect stays available and says why if it fails.
  const { data: googleClient } = useTeamGoogleClientQuery(team?.id)
  const admin = useAdminName(team?.id, Boolean(team && team.role !== 'ADMINISTRATOR'))
  const [disconnecting, setDisconnecting] = useState<PersonalCredentialProvider | null>(null)
  const refresh = () => void listed.refetch()

  useEffect(() => {
    if (listed.error) toast.apiError(t('Could not load Personal Credentials'), listed.error)
  }, [listed.error])

  const connect = useMutation({
    mutationFn: async (provider: PersonalCredentialProvider) => {
      const { authorizeUrl } = await api.atlasStartPersonalCredential(
        provider,
        isGoogle(provider) ? team?.id : undefined,
      )

      await api.appOpenExternal(authorizeUrl)
    },
    onError: (err, provider) => {
      if (parseAtlasError(err).code === 'personal_credential_not_configured') {
        toast.error(
          t('Could not connect {name}', { name: nameOf(provider) }),
          t('Not configured on this server yet'),
        )
      } else {
        toast.apiError(t('Could not connect {name}', { name: nameOf(provider) }), err)
      }
    },
  })
  const disconnect = useMutation({
    mutationFn: (provider: PersonalCredentialProvider) =>
      api.atlasDeletePersonalCredential(provider, isGoogle(provider) ? team?.id : undefined),
    onSuccess: (_result, provider) =>
      toast.success(t('{name} disconnected', { name: nameOf(provider) })),
    onError: (err, provider) =>
      toast.apiError(t('Could not disconnect {name}', { name: nameOf(provider) }), err),
    onSettled: personalCredentialsChanged,
  })
  const busy = [connect, disconnect].find((write) => write.isPending)?.variables ?? null

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
              <div className="h-[72px] rounded-lg bg-state-selected" />
              <div className="h-[72px] rounded-lg bg-state-selected" />
            </div>
          }
        >
          <div className="space-y-3">
            {PROVIDERS.map(({ provider, name, description }) => {
              const credential = credentialFor(credentials, provider, team?.id)
              const noTeamClient = isGoogle(provider) && googleClient?.clientId === null
              const needsTeamClient = noTeamClient && !googleClient.composio
              const viaComposio = noTeamClient && googleClient.composio

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
                      onClick={() => connect.mutate(provider)}
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
        onConfirm={async () => {
          // The toast says what failed, so the dialog just closes.
          if (disconnecting) await disconnect.mutateAsync(disconnecting).catch(() => null)
        }}
        onClose={() => setDisconnecting(null)}
      />
    </div>
  )
}
