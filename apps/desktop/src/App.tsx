import { useEffect, useState } from 'react'

import { api } from './api'
import { Workspace } from './app/workspace/Workspace'
import { claimComposerDrafts, clearComposerDrafts } from './components/agent/panel/composerDrafts'
import { CurrentUserContext } from './hooks/useCurrentUser'
import { identifyUser, resetAnalytics, track } from './lib/analytics'
import { LoginView } from './views/LoginView'

import type { UserInfo } from './types'

type AuthState =
  { status: 'checking' } | { status: 'anonymous' } | { status: 'authenticated'; user: UserInfo }

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' })

  useEffect(() => {
    let cancelled = false

    api
      .authStatus()
      .then((s) => {
        if (cancelled) return
        if (s.loggedIn) {
          identifyUser(s.user)
          claimComposerDrafts(s.user.id)
          setAuth({ status: 'authenticated', user: s.user })
        } else {
          setAuth({ status: 'anonymous' })
        }
      })
      .catch(() => !cancelled && setAuth({ status: 'anonymous' }))

    return () => {
      cancelled = true
    }
  }, [])

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
        onLogin={(user) => {
          identifyUser(user)
          claimComposerDrafts(user.id)
          track('login', { method: 'oauth' })
          setAuth({ status: 'authenticated', user })
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
        onLogout={async () => {
          await api.authLogout()
          clearComposerDrafts()
          track('logout')
          resetAnalytics()
          setAuth({ status: 'anonymous' })
        }}
      />
    </CurrentUserContext>
  )
}
