import { createContext, useContext } from 'react'

import type { UserInfo } from '../types'

export const CurrentUserContext = createContext<UserInfo | null>(null)

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}
