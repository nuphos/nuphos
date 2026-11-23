import { useState } from 'react'

import { api } from '../../api'
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
import { connectPersonalCredential, nameOf } from '../settings/personalCredentials'
import { useAdminName } from '../settings/useAdminName'

import { usePersonalCredentials } from './use-personal-credentials'

import type { PersonalCredential, PersonalCredentialProvider } from '../../types'

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
 * The member's own accounts for one service, shown in its detail: each account has its own
 * Disconnect, and GitHub and Linear can connect another account beside the first.
 */
export function PersonalAccountManager({
  teamId,
  provider,
  onOpenTeamSettings,
}: {
  teamId: string
  provider: PersonalCredentialProvider
  onOpenTeamSettings: () => void
}) {
  const { credentials, googleClient, refresh } = usePersonalCredentials(teamId)
  const [busy, setBusy] = useState(false)
  const [disconnecting, setDisconnecting] = useState<PersonalCredential | null>(null)
  const name = nameOf(provider)
  const accounts = credentialsFor(credentials, provider, teamId)
  const needsTeamClient = accounts.length === 0 && needsTeamGoogleClient(provider, googleClient)

  async function connect() {
    setBusy(true)
    try {
      await connectPersonalCredential(provider, teamId)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect({ id }: PersonalCredential) {
    setBusy(true)
    try {
      await api.atlasDeletePersonalCredential(provider, isGoogle(provider) ? teamId : undefined, id)
      toast.success(t('{name} disconnected', { name }))
    } catch (err) {
      toast.apiError(t('Could not disconnect {name}', { name }), err)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <div>
      {accounts.length === 0 ? (
        <Button
          type="button"
          size="sm"
          disabled={busy || needsTeamClient}
          onClick={() => void connect()}
        >
          {t('Connect')}
        </Button>
      ) : (
        <PersonalAccountLines
          accounts={accounts}
          busy={busy}
          canAddMore={MULTI_ACCOUNT_PROVIDERS.includes(provider)}
          onDisconnect={setDisconnecting}
          onConnectAnother={() => void connect()}
        />
      )}
      {needsTeamClient && (
        <GoogleClientHint teamId={teamId} onOpenTeamSettings={onOpenTeamSettings} />
      )}
      <ConfirmDialog
        open={disconnecting !== null}
        title={t('Disconnect {name}', { name })}
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
