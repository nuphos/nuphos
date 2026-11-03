import { Suspense, use, useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { api, onSessionRejected } from './api'
import {
  ACCOUNT_TAKEOVER_ATTR,
  addAccountRequest,
  cancelAddAccount,
  subscribeAddAccount,
  takeSignInNotice,
} from './app/accounts'
import { signOutLocally } from './app/signOutLocally'
import { enterAs, startupAuth } from './app/startupAuth'
import { Workspace } from './app/workspace/Workspace'
import { toast } from './components/ui/toast'
import { CurrentUserContext } from './hooks/useCurrentUser'
import { t } from './i18n'
import { identifyUser, track } from './lib/analytics'
import { LoginView } from './views/LoginView'
import { AgentSetupHost } from './views/onboarding/setup/AgentSetupHost'
import { BoxPaywallHost } from './views/settings/BoxPaywall'

import type { AuthState } from './app/startupAuth'

function Splash() {
  return (
    <div className="h-full flex flex-col bg-main">
      <div className="titlebar-drag h-[44px] flex-shrink-0" />
      <div className="flex-1" />
    </div>
  )
}

// Left by an account that had to sign in again on another backend (accounts.ts).
const signInNotice = takeSignInNotice()

export default function App() {
  return (
    <Suspense fallback={<Splash />}>
      <SignedInApp />
    </Suspense>
  )
}

function SignedInApp() {
  const [auth, setAuth] = useState<AuthState>(use(startupAuth()))
  // Signing in to one more account, over the workspace.
  const adding = useSyncExternalStore(subscribeAddAccount, addAccountRequest)
  const signedIn = auth.status === 'authenticated'
  // The sign-in screen holds focus, so no shortcut reaches a card behind it.
  const takeFocus = useCallback((el: HTMLDivElement | null) => el?.focus(), [])

  useEffect(() => {
    if (!signedIn) return
    // The backend already ended this session: leave even if the file keeps it.
    onSessionRejected(() => void logout(true))

    return () => onSessionRejected(null)
  }, [signedIn])

  async function logout(rejected = false) {
    const undo = signOutLocally()

    try {
      await api.authLogout()
    } catch (e) {
      // Still signed in on this computer: say so, and put this window's drafts
      // back, instead of showing a sign-in screen the next launch would skip.
      // A rejected session leaves anyway.
      if (!rejected && auth.status === 'authenticated') {
        undo(auth.user)
        toast.apiError(t('Could not log out'), e)

        return
      }
    }
    // Every window then reloads (account-leave.ts) and lists the accounts left.
    setAuth({ status: 'anonymous', accounts: [] })
  }

  const signIn = (
    <LoginView
      accounts={auth.status === 'anonymous' ? auth.accounts : []}
      notice={adding?.notice ?? signInNotice}
      onCancel={
        adding && signedIn
          ? () => {
              void api.authCancel()
              cancelAddAccount()
            }
          : undefined
      }
      onLogin={(user) => {
        // Who signed in first, so the event is theirs and not the last account's.
        // Its team is none: the workspace behind Add account is the previous
        // account's, and the scope stays as it is for what follows.
        identifyUser(user)
        track('login', { method: 'oauth', team_id: null })
        cancelAddAccount()
        // Signed in over another account: every window reloads as this one.
        if (!signedIn) void enterAs(user).then(setAuth)
      }}
    />
  )

  if (auth.status === 'anonymous') return signIn

  return (
    <CurrentUserContext value={auth.user}>
      {/* Inert behind the sign-in screen: no focus, no keys, nothing to approve. */}
      <div className="contents" inert={adding !== null}>
        <Workspace
          user={auth.user}
          onUserUpdated={(user) => {
            identifyUser(user)
            setAuth({ status: 'authenticated', user })
          }}
          onLogout={() => logout()}
        />
        <BoxPaywallHost />
        <AgentSetupHost />
      </div>
      {/* Over the workspace, which stays mounted: Cancel returns to it as it was. */}
      {adding && (
        <div
          ref={takeFocus}
          tabIndex={-1}
          {...{ [ACCOUNT_TAKEOVER_ATTR]: '' }}
          className="fixed inset-0 z-[1000] bg-main outline-none"
        >
          {signIn}
        </div>
      )}
    </CurrentUserContext>
  )
}
