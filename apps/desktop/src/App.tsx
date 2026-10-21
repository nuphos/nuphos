import { useEffect, useState } from 'react'

import { api } from './api'
import { Workspace } from './app/workspace/Workspace'
import {
  claimComposerDrafts,
  clearComposerDrafts,
  composerDraftOwner,
} from './components/agent/panel/composerDrafts'
import { toast } from './components/ui/toast'
import { CurrentUserContext } from './hooks/useCurrentUser'
import { forgetMacAccounts } from './hooks/useMacSignIn'
import { identifyUser, resetAnalytics, track } from './lib/analytics'
import { LoginView } from './views/LoginView'
import { BoxPaywallHost } from './views/settings/BoxPaywall'

import type { AccountChange, AuthStatus, OtherAccount, UserInfo } from './types'

type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous'; others: OtherAccount[] }
  | { status: 'authenticated'; user: UserInfo }
  // Signing in to one more account; `user` stays signed in meanwhile.
  | { status: 'adding'; user: UserInfo }

type SetAuth = (next: AuthState) => void

async function enter(setAuth: SetAuth, user: UserInfo) {
  identifyUser(user)
  claimComposerDrafts(composerDraftOwner(user.id, await api.atlasGetApiUrl()))
  setAuth({ status: 'authenticated', user })
}

/** The sign-in screen, offering the accounts still signed in on this device. */
async function signedOut(setAuth: SetAuth) {
  const others = await api.authAccounts().catch(() => [])

  setAuth({ status: 'anonymous', others })
}

// Switching to an account whose sign-in the backend rejects drops it.
async function switchAccount(setAuth: SetAuth, key: string) {
  // Sent first, as the outgoing account: a successful switch reloads every
  // window, this one included, before the call below returns.
  track('switch_account')
  resetAnalytics()
  const s: AuthStatus = await api.authSwitch(key)

  if (s.loggedIn) {
    await enter(setAuth, s.user)

    return
  }
  toast.error('That sign-in has expired', 'Sign in to the account again.')
  await signedOut(setAuth)
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false
    const settle = (next: AuthState) => {
      if (!cancelled) setAuth(next)
    }

    api
      .authStatus()
      .then((s) => (s.loggedIn ? enter(settle, s.user) : signedOut(settle)))
      .catch(() => settle({ status: 'anonymous', others: [] }))

    return () => {
      cancelled = true
    }
  }, [])

  const onLogout = async (change?: AccountChange) => {
    if (change?.kind === 'add') {
      if (auth.status === 'authenticated') setAuth({ status: 'adding', user: auth.user })

      return
    }
    forgetMacAccounts()
    if (change?.kind === 'switch') {
      await switchAccount(setAuth, change.key)

      return
    }
    // Sent while still attributed to the account signing out; signing out
    // also reloads the other windows.
    track('logout')
    resetAnalytics()
    clearComposerDrafts()
    if (change?.kind === 'logoutAll') await api.authLogoutAll()
    else await api.authLogout()
    await signedOut(setAuth)
  }

  if (auth.status === 'checking') {
    return (
      <div className="h-full flex flex-col bg-main">
        <div className="titlebar-drag h-[44px] flex-shrink-0" />
        <div className="flex-1" />
      </div>
    )
  }

  if (auth.status === 'anonymous') {
    return (
      <LoginView
        others={auth.others}
        onPickAccount={async (key) => {
          await switchAccount(setAuth, key)
        }}
        onLogin={(user) => {
          track('login', { method: 'oauth' })
          void enter(setAuth, user)
        }}
      />
    )
  }

  const adding = auth.status === 'adding'

  return (
    <CurrentUserContext value={auth.user}>
      <Workspace
        key={auth.user.id}
        user={auth.user}
        onUserUpdated={(user) => {
          identifyUser(user)
          setAuth(adding ? { status: 'adding', user } : { status: 'authenticated', user })
        }}
        onLogout={onLogout}
      />
      {adding && (
        // Over the workspace rather than instead of it: its tabs and terminals
        // stay as they are if the new sign-in is cancelled.
        <div className="fixed inset-0 z-[1900] bg-main">
          <LoginView
            adding={auth.user}
            onCancel={() => setAuth({ status: 'authenticated', user: auth.user })}
            onLogin={(user) => {
              if (user.id === auth.user.id) {
                // The current account, signed in again: back to the workspace.
                track('login', { method: 'oauth' })
                setAuth({ status: 'authenticated', user })

                return
              }
              // Another account reloads every window as it once saved:
              // attribute this sign-in, and what follows, to it.
              resetAnalytics()
              identifyUser(user)
              track('login', { method: 'oauth' })
            }}
          />
        </div>
      )}
      <BoxPaywallHost />
    </CurrentUserContext>
  )
}
