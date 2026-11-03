import { BrowserWindow } from 'electron'

import { resetAnalyticsUser } from '../analytics'
import { commitConfigIf } from '../auth/config.ts'
import { authSession } from '../auth-session.ts'
import * as k8s from '../k8s'
import * as podExec from '../pod-exec'
import * as terminal from '../terminal'

import { followAccount } from './account-leave-core.ts'

// Wires leaving an account to the app (account-leave-core.ts), once, as
// main.ts loads.
followAccount(authSession, {
  settled: () =>
    commitConfigIf(
      () => true,
      () => Promise.resolve(null),
    ),
  teardown: () => {
    k8s.stopAllPortForwards()
    terminal.closeAllSshSessions()
    // Closes exec sessions and deletes any node-shell pods.
    podExec.closeAllPodExecSessions()
    resetAnalyticsUser()
  },
  reload: () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.reload()
    }
  },
})
