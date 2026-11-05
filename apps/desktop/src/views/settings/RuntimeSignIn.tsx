import { adminName } from '../../components/agent/panel/agentSignInModel'
import { Button } from '../../components/ui/button'
import { useTeamMemberList } from '../../hooks/useTeamMemberList'
import { t } from '../../i18n'

import { longLivedSignIn } from './longLivedSignIn'

import type { RuntimeInstance } from '../../types/runtime'

/** Antigravity signs in through a browser on the agent's own loopback address, so only the app can. */
const HOST_SIGN_IN: Partial<Record<RuntimeInstance['provider'], string>> = {
  'claude-code': 'docker exec -it <container> claude auth login',
  codex: 'docker exec -it <container> codex login --device-auth',
  grok: 'docker exec -it <container> grok login --device-auth',
  opencode: 'docker exec -it <container> opencode providers login',
}

function memberNote(askAdmin: string | null | undefined): string {
  if (askAdmin === undefined) return t('Not signed in.')

  return askAdmin
    ? t('Not signed in. Ask {name} to sign it in.', { name: askAdmin })
    : t('Not signed in. Ask a workspace administrator to sign it in.')
}

/** The agent owns its login; this only shows what the agent reports. */
export function RuntimeSignIn({
  instance,
  authenticated,
  expiresAt,
  onSignIn,
  memberOf,
}: {
  instance: RuntimeInstance
  authenticated: boolean | undefined
  /** Set for a sign-in that lapses on its own: a one-year token. */
  expiresAt?: string
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
  // OpenCode signs in to one model provider at a time and keeps them all.
  if (authenticated && !(instance.provider === 'opencode' && onSignIn)) {
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
