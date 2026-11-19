import { useState } from 'react'

import { LocalAgentSignIn } from '../../../views/settings/LocalAgentSignIn'
import { RuntimeLoginDialog } from '../../../views/settings/RuntimeLoginDialog'
import { Button } from '../../ui/button'

import type { SignInRoute } from './agentSignInModel'

/**
 * The sign-in itself, where the viewer can do it: this computer's CLI sign-in,
 * or a button that opens the runtime's sign-in dialog. Nothing on another route.
 */
export function AgentSignInButton({
  teamId,
  route,
  label,
  onSignedIn,
}: {
  teamId: string | undefined
  route: SignInRoute
  label: string
  /** After the sign-in closes: whether the agent is now connected. */
  onSignedIn: (connected: boolean) => void
}) {
  const [signingIn, setSigningIn] = useState(false)

  if (route.kind === 'cli')
    return <LocalAgentSignIn provider={route.provider} label={label} onClosed={onSignedIn} />
  if (route.kind !== 'dialog') return null

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setSigningIn(true)}>
        {label}
      </Button>
      {signingIn && teamId && (
        <RuntimeLoginDialog
          teamId={teamId}
          instance={route.instance}
          onClose={(connected) => {
            setSigningIn(false)
            onSignedIn(connected)
          }}
        />
      )}
    </>
  )
}
