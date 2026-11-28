import { Notification, shell } from 'electron'

import { t } from './i18n.ts'

/** How asking for notifications went: shown, refused by the OS, or no answer yet. */
export type NotificationAsk = 'shown' | 'failed' | 'pending' | 'unsupported'

/**
 * Shows the first notification from the main process. macOS asks for permission
 * the first time an app posts one, so this is what raises the system prompt; an
 * app the user already turned off fails instead. Electron cannot read the
 * permission back, so the answer is how this notification went.
 */
export function requestNotifications(): Promise<NotificationAsk> {
  if (!Notification.isSupported()) return Promise.resolve('unsupported')

  return new Promise((resolve) => {
    const notice = new Notification({
      title: t('Notifications are on'),
      body: t('Nuphos will tell you when a Bot is done or needs an answer.'),
      silent: true,
    })
    // The prompt waits for the person; the tour does not wait forever.
    const timer = setTimeout(() => resolve('pending'), 30_000)
    const settle = (answer: NotificationAsk) => {
      clearTimeout(timer)
      resolve(answer)
    }

    notice.once('show', () => settle('shown'))
    notice.once('failed', () => settle('failed'))
    notice.show()
  })
}

/** System Settings › Notifications, where a refused app is turned back on. */
export function openNotificationSettings(): Promise<void> {
  return process.platform === 'darwin'
    ? shell.openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension')
    : process.platform === 'win32'
      ? shell.openExternal('ms-settings:notifications')
      : Promise.resolve()
}
