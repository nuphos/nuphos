import type { RuntimeInstance } from '../../types/runtime'

const HOST_SIGN_IN: Record<RuntimeInstance['provider'], string> = {
  'claude-code': 'docker exec -it <container> claude auth login',
  codex: 'docker exec -it <container> codex login --device-auth',
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
  if (authenticated) {
    return <p className="px-4 py-4 text-xs text-tertiary">Signed in on the agent.</p>
  }
  const selfHosted = instance.kind === 'external'
  const signedOut = authenticated === false
  const note = selfHosted
    ? signedOut
      ? 'Not signed in. Sign in here, or on the agent’s host:'
      : 'This agent does not report its sign-in. If conversations ask for a sign-in, update its image, or sign in on its host:'
    : signedOut
      ? 'Not signed in.'
      : 'This agent does not report its sign-in yet.'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs leading-relaxed text-tertiary">{note}</p>
        {selfHosted && (
          <code className="block break-all font-mono text-[12px] text-secondary">
            {HOST_SIGN_IN[instance.provider]}
          </code>
        )}
      </div>
      {signedOut && onSignIn && (
        <button
          type="button"
          onClick={onSignIn}
          className="shrink-0 rounded-md bg-zViolet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-zViolet-500"
        >
          Sign in
        </button>
      )}
    </div>
  )
}
