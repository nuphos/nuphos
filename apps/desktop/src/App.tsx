import { useEffect, useState } from 'react'

import { api, onSessionRejected } from './api'
import { onAddAccount } from './app/accounts'
import { setStorageAccount } from './app/accountStorage'
import { Workspace } from './app/workspace/Workspace'
import { claimComposerDrafts, clearComposerDrafts } from './components/agent/panel/composerDrafts'
import {
  claimClearedReplies,
  clearClearedReplies,
} from './components/agent/panel/composerReplyCleared'
import { CurrentUserContext } from './hooks/useCurrentUser'
import { identifyUser, resetAnalytics, track } from './lib/analytics'
import { LoginView } from './views/LoginView'
import { BoxPaywallHost } from './views/settings/BoxPaywall'

import type { AddAccountRequest } from './app/accounts'
import type { AccountSummary, UserInfo } from './types'

type AuthState =
  { status: 'checking' } | { status: 'anonymous' } | { status: 'authenticated'; user: UserInfo }

/** The accounts signed in on this computer; none if the list cannot be read. */
async function readAccounts(): Promise<AccountSummary[]> {
  return api.authListAccounts().catch(() => [])
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' })
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  // Signing in to one more account, over the workspace.
  const [adding, setAdding] = useState<AddAccountRequest | null>(null)

  // Every account change reloads the window (account-leave.ts), so the
  // account this page shows is settled here, once, before the workspace reads
  // anything stored for it.
  async function enter(user: UserInfo) {
    const list = await readAccounts()

    setStorageAccount(list.find((a) => a.active)?.key ?? null)
    setAccounts(list)
    identifyUser(user)
    claimComposerDrafts(user.id)
    claimClearedReplies(user.id)
    setAuth({ status: 'authenticated', user })
  }

  useEffect(() => {
    let cancelled = false

    api
      .authStatus()
      .then(async (s) => {
        if (cancelled) return
        if (s.loggedIn) return enter(s.user)
        setAccounts(await readAccounts())
        setAuth({ status: 'anonymous' })
      })
      .catch(() => !cancelled && setAuth({ status: 'anonymous' }))

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      onAddAccount((request) => {
        setAdding(request)
        // An account that had to sign in again has left the list.
        void readAccounts().then(setAccounts)
      }),
    [],
  )

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
    setAuth({ status: 'anonymous' })
  }

  if (auth.status === 'checking') {
    return (
      <div className="h-full flex flex-col bg-main">
        <div className="titlebar-drag h-[44px] flex-shrink-0" />
        <div className="flex-1" />
      </div>
    )
  }

  if (auth.status === 'anonymous' || adding) {
    return (
      <LoginView
        accounts={auth.status === 'authenticated' ? [] : accounts}
        notice={adding?.notice}
        onCancel={
          adding && auth.status === 'authenticated'
            ? () => {
                void api.authCancel()
                setAdding(null)
              }
            : undefined
        }
        onLogin={(user) => {
          track('login', { method: 'oauth' })
          setAdding(null)
          // Signed in over another account: every window reloads as this one.
          if (auth.status !== 'authenticated') void enter(user)
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
