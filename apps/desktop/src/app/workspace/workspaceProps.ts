import type { AccountChange, UserInfo } from '../../types'

export type WorkspaceProps = {
  user: UserInfo
  onUserUpdated: (user: UserInfo) => void
  onLogout: (change?: AccountChange) => Promise<void>
}
