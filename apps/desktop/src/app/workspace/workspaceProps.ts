import type { UserInfo } from '../../types'

export type WorkspaceProps = {
  user: UserInfo
  onUserUpdated: (user: UserInfo) => void
  onLogout: () => Promise<void>
}
