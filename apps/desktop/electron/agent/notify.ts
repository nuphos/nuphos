import { BrowserWindow, Notification } from 'electron'

import { raiseWindow } from '../window-raise'

import type { WebContents } from 'electron'

export function send(wc: WebContents, channel: string, payload: unknown) {
  if (wc.isDestroyed()) return
  wc.send(channel, payload)
}

export function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, channel, payload)
}

// A shown Notification with no live JS reference can be garbage collected before
// the user gets to it, taking its click handler with it. macOS gives no
// guarantee that 'close' fires (an ignored notification just sits in Notification
// Center), so the bound is FIFO: the oldest are the least likely to still be
// clicked.
const liveNotifications = new Set<Notification>()
const MAX_LIVE_NOTIFICATIONS = 50

function retainNotification(n: Notification): () => void {
  liveNotifications.add(n)
  for (const oldest of liveNotifications) {
    if (liveNotifications.size <= MAX_LIVE_NOTIFICATIONS) break
    liveNotifications.delete(oldest)
  }

  return () => liveNotifications.delete(n)
}

// Fired by the renderer, not from the stream: a stream ending is not the turn
// stopping (step-cap pauses and client-tool handoffs both close one and continue
// with a fresh streamId), and only the renderer's end handler knows which it is.
// Title and body are composed there too — see src/lib/agentStopNotification.ts.
export function notifyAgentStopped(args: {
  title: string
  body: string
  sessionId: string
  teamId?: string
  parentWindow?: BrowserWindow | null
}): void {
  const { title, body, sessionId, teamId, parentWindow } = args

  if (!Notification.isSupported()) return
  if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
  const n = new Notification({ title, body })
  const release = retainNotification(n)

  n.on('close', release)
  n.on('click', () => {
    release()
    if (!parentWindow || !raiseWindow(parentWindow)) return
    send(parentWindow.webContents, 'agent:focus-session', { sessionId, teamId })
  })
  n.show()
}
