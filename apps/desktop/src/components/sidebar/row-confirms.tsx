import { useArchiveBotConfirm } from './archive-bot-confirm'
import { useLeaveTaskConfirm } from './leave-task-confirm'

/** The questions a row's menu asks before acting, and the dialogs that ask them. */
export function useRowConfirms(teamId: string, archiveChat: (sessionId: string) => Promise<void>) {
  const archiveBot = useArchiveBotConfirm(archiveChat)
  const leaveTask = useLeaveTaskConfirm(teamId)

  return {
    menuProps: { confirmArchiveBot: archiveBot.confirm, confirmLeaveTask: leaveTask.confirm },
    dialogs: (
      <>
        {archiveBot.dialog}
        {leaveTask.dialog}
      </>
    ),
  }
}
