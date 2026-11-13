import { adminName } from '../../components/agent/panel/agentSignInModel'
import { Button } from '../../components/ui/button'
import { useTeamMemberList } from '../../hooks/useTeamMemberList'
import { t } from '../../i18n'

import { longLivedSignIn } from './longLivedSignIn'

import type { RuntimeInstance } from '../../types/runtime'
import type { OpenAbRuntimeStatus } from '../../types/team'

/** Each provider's official terminal sign-in, when its operator channel is unavailable. */
const HOST_SIGN_IN: Partial<Record<RuntimeInstance['provider'], string>> = {
  'claude-code': 'docker exec -it <container> claude auth login',
  codex: 'docker exec -it <container> codex login --device-auth',
  grok: 'docker exec -it <container> grok login --device-auth',
  antigravity: 'docker exec -it <container> agy acp --login',
  opencode: 'docker exec -it <container> opencode providers login',
}

function memberNote(askAdmin: string | null | undefined): string {
  if (askAdmin === undefined) return t('Not signed in.')

  return askAdmin
    ? t('Not signed in. Ask {name} to sign it in.', { name: askAdmin })
    : t('Not signed in. Ask a workspace administrator to sign it in.')
}

/** The agent owns its login; this only shows what the agent reports. */
function RuntimeSignInContent({
  instance,
  runtime: { authenticated, credentialExpiresAt: expiresAt, apiKey },
  onSignIn,
  memberOf,
}: {
  instance: RuntimeInstance
  /** What the agent reports: whether it is signed in, with an API key, until when (a one-year token). */
  runtime: Pick<OpenAbRuntimeStatus, 'authenticated' | 'credentialExpiresAt' | 'apiKey'>
  onSignIn?: () => void
  /** Set for a member, who cannot sign it in: the team whose administrator can. */
  memberOf?: string
}) {
  const members = useTeamMemberList(memberOf, Boolean(memberOf))
  const askAdmin = memberOf ? adminName(members) : undefined
  const longLived = authenticated && expiresAt ? longLivedSignIn(expiresAt) : null

  if (longLived)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <p className="min-w-0 text-xs leading-relaxed text-tertiary">{longLived.note}</p>
        {longLived.renew && onSignIn && (
          <Button size="sm" className="shrink-0" type="button" onClick={onSignIn}>
            {t('Sign in')}
          </Button>
        )}
      </div>
    )
  if (authenticated && apiKey)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <p className="min-w-0 text-xs leading-relaxed text-tertiary">
          {t('Signed in with an API key.')}
        </p>
        {onSignIn && (
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            type="button"
            onClick={onSignIn}
          >
            {t('Manage')}
          </Button>
        )}
      </div>
    )
  // OpenCode and Hermes Agent sign in to one model provider at a time and keep them all.
  if (authenticated && !(['opencode', 'hermes'].includes(instance.provider) && onSignIn)) {
    return <p className="px-4 py-4 text-xs text-tertiary">{t('Signed in on the runtime.')}</p>
  }
  const signedOut = authenticated === false
  const member = askAdmin !== undefined
  // Only an administrator signs a team runtime in, here or on its host.
  const hostSignIn =
    instance.kind === 'external' && !member ? HOST_SIGN_IN[instance.provider] : undefined
  const note = authenticated
    ? t('Signed in on the runtime. Sign in to another model provider to use its models too.')
    : hostSignIn
      ? signedOut
        ? t('Not signed in. Sign in here, or on the runtime’s host:')
        : t('Sign-in status is unknown. Try signing in here, or on the runtime’s host:')
      : signedOut
        ? memberNote(askAdmin)
        : t('This runtime does not report its sign-in yet.')

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs leading-relaxed text-tertiary">{note}</p>
        {hostSignIn && !authenticated && (
          <code className="block break-all font-mono text-[12px] text-secondary">{hostSignIn}</code>
        )}
      </div>
      {onSignIn && (
        <Button size="sm" className="shrink-0" type="button" onClick={onSignIn}>
          {authenticated ? t('Add a provider') : t('Sign in')}
        </Button>
      )}
    </div>
  )
}

/** Directory isolation does not isolate the CLI's native keyring identity. */
export function RuntimeSignIn(props: Parameters<typeof RuntimeSignInContent>[0]) {
  return (
    <div>
      {props.instance.provider === 'antigravity' && (
        <p className="px-4 pt-4 text-xs leading-relaxed text-tertiary">
          {t(
            'Antigravity shares Google sign-in with other Antigravity apps under the same OS account. Signing in or using the CLI to sign out may affect them. Separate runtime accounts are not supported.',
          )}
        </p>
      )}
      <RuntimeSignInContent {...props} />
    </div>
  )
}
