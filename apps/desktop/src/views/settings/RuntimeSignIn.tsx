import { Button } from '../../components/ui/button'

import type { RuntimeInstance } from '../../types/runtime'

/** Antigravity signs in through a browser on the agent's own loopback address, so only the app can. */
const HOST_SIGN_IN: Partial<Record<RuntimeInstance['provider'], string>> = {
  'claude-code': 'docker exec -it <container> claude auth login',
  codex: 'docker exec -it <container> codex login --device-auth',
  grok: 'docker exec -it <container> grok login --device-auth',
  opencode: 'docker exec -it <container> opencode providers login',
}

/** The agent owns its login; this only shows what the agent reports. */
export function RuntimeSignIn({
  instance,
  authenticated,
  onSignIn,
}: {
  instance: RuntimeInstance
  authenticated: boolean | undefined
  onSignIn?: () => void
}) {
  // OpenCode signs in to one model provider at a time and keeps them all.
  if (authenticated && !(instance.provider === 'opencode' && onSignIn)) {
    return <p className="px-4 py-4 text-xs text-tertiary">Signed in on the runtime.</p>
  }
  const hostSignIn = instance.kind === 'external' ? HOST_SIGN_IN[instance.provider] : undefined
  const signedOut = authenticated === false
  const note = authenticated
    ? 'Signed in on the runtime. Sign in to another model provider to use its models too.'
    : hostSignIn
      ? signedOut
        ? 'Not signed in. Sign in here, or on the runtime’s host:'
        : 'Sign-in status is unknown. Try signing in here, or on the runtime’s host:'
      : signedOut
        ? 'Not signed in.'
        : 'This runtime does not report its sign-in yet.'

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
          {authenticated ? 'Add a provider' : 'Sign in'}
        </Button>
      )}
    </div>
  )
}
