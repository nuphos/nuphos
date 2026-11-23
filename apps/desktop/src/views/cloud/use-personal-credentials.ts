import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { PERSONAL_CREDENTIALS_CHANGED } from '../settings/personalCredentials'

import type { PersonalCredential, TeamGoogleClient } from '../../types'

/** The member's own accounts and whether this team can connect Google ones, kept fresh. */
export function usePersonalCredentials(teamId: string) {
  const [credentials, setCredentials] = useState<PersonalCredential[] | null>(null)
  // Whether Google accounts can connect here; unknown (null) leaves Connect to say why if not.
  const [googleClient, setGoogleClient] = useState<TeamGoogleClient | null>(null)
  // Status only decorates the rows; if it cannot be read they still offer Connect.
  const refresh = useCallback(() => {
    void api
      .atlasListPersonalCredentials()
      .then(setCredentials)
      .catch(() => setCredentials(null))
  }, [])

  useEffect(() => {
    void api
      .atlasGetTeamGoogleClient(teamId)
      .then(setGoogleClient)
      .catch(() => setGoogleClient(null))
  }, [teamId])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener(PERSONAL_CREDENTIALS_CHANGED, refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener(PERSONAL_CREDENTIALS_CHANGED, refresh)
    }
  }, [refresh])

  return { credentials, googleClient, refresh }
}
