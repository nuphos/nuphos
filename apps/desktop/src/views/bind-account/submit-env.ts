import type { BindingShare } from '../../lib/bindingShare'

export type SubmitEnv = {
  teamId: string
  onBound: () => void
  onClose: () => void
  /** Who the member chose to share the connection with; absent keeps the team default. */
  share?: BindingShare
}
