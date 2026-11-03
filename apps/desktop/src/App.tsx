import { Suspense, use, useEffect, useState, useSyncExternalStore } from 'react'

import { api, onSessionRejected } from './api'
import { addAccountRequest, cancelAddAccount, subscribeAddAccount } from './app/accounts'
import { enterAs, startupAuth } from './app/startupAuth'
import { Workspace } from './app/workspace/Workspace'
import { clearComposerDrafts } from './components/agent/panel/composerDrafts'
import { clearClearedReplies } from './components/agent/panel/composerReplyCleared'
import { CurrentUserContext } from './hooks/useCurrentUser'
import { identifyUser, resetAnalytics, track } from './lib/analytics'
import { LoginView } from './views/LoginView'
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

  useEffect(() => {
    if (!signedIn) return
    onSessionRejected(() => void logout())

    return () => onSessionRejected(null)
  }, [signedIn])

  async function logout() {
    // Leave the workspace even if the main process fails to clear the token:
    // a rejected session must never strand the user on a dead workspace.
    await api.authLogout().catch(() => undefined)
    clearComposerDrafts()
    clearClearedReplies()
    track('logout')
    resetAnalytics()
    // Every window then reloads (account-leave.ts) and lists the accounts left.
    setAuth({ status: 'anonymous', accounts: [] })
  }

  if (auth.status === 'anonymous' || adding) {
    return (
      <LoginView
        accounts={auth.status === 'anonymous' ? auth.accounts : []}
        notice={adding?.notice}
        onCancel={
          adding && signedIn
            ? () => {
                void api.authCancel()
                cancelAddAccount()
              }
            : undefined
        }
        onLogin={(user) => {
          track('login', { method: 'oauth' })
          cancelAddAccount()
          // Signed in over another account: every window reloads as this one.
          if (!signedIn) void enterAs(user).then(setAuth)
        }}
      />
    )
  }

  return (
    <CurrentUserContext value={auth.user}>
      <Workspace
        user={auth.user}
        onUserUpdated={(user) => {
          identifyUser(user)
          setAuth({ status: 'authenticated', user })
        }}
        onLogout={logout}
      />
      <BoxPaywallHost />
    </CurrentUserContext>
  )
}
