import { BrowserWindow, Notification } from 'electron'

import { authSession } from '../auth-session.ts'
import { openAsAccount } from '../main/account-for-link.ts'
import { accountOf } from '../main/account-leave-core.ts'
import { openAppPath } from '../main/deep-links.ts'
import { raiseWindow } from '../window-raise.ts'

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

// Every window's sidebar polls the same mentions, so each is announced once here.
// Only recent ones matter: an old mention is no longer new to any poll.
const announcedMentions = new Set<string>()
const MAX_ANNOUNCED_MENTIONS = 500

/** Someone @mentioned this person; clicking opens where they said it. */
export function notifyMention(args: {
  messageId: string
  title: string
  body: string
  sessionId: string
  teamId?: string
  parentWindow?: BrowserWindow | null
}): void {
  if (announcedMentions.has(args.messageId)) return
  announcedMentions.add(args.messageId)
  for (const oldest of announcedMentions) {
    if (announcedMentions.size <= MAX_ANNOUNCED_MENTIONS) break
    announcedMentions.delete(oldest)
  }
  notifyAgentStopped(args)
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
  // Raised for the account in use now; clicked maybe after a switch.
  const owner = accountOf(authSession.context())

  if (!Notification.isSupported()) return
  if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
  const n = new Notification({ title, body })
  const release = retainNotification(n)

  n.on('close', release)
  n.on('click', () => {
    release()
    // Since raised, the app moved to another account: back to this one first,
    // then open the conversation in its reloaded workspace.
    if (owner && teamId && accountOf(authSession.context()) !== owner) {
      void openAsAccount(owner, () => openAppPath(`/teams/${teamId}/agent/${sessionId}`))

      return
    }
    if (!parentWindow || !raiseWindow(parentWindow)) return
    send(parentWindow.webContents, 'agent:focus-session', { sessionId, teamId })
  })
  n.show()
}

// Every window's sidebar watches the same requests, so each is announced once here.
const announcedApprovals = new Set<string>()

/**
 * A teammate asks to run a conversation on this person's computer. Clicking opens
 * the Inbox, where it is answered: the owner cannot open the teammate's conversation.
 */
export function notifyShareApproval(args: {
  approvalId: string
  title: string
  body: string
  openInbox: () => void
}): void {
  const { approvalId, title, body, openInbox } = args

  if (announcedApprovals.has(approvalId)) return
  announcedApprovals.add(approvalId)
  if (!Notification.isSupported()) return
  // On screen, the sidebar's Inbox badge already says it.
  if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return
  const n = new Notification({ title, body })
  const release = retainNotification(n)

  n.on('close', release)
  n.on('click', () => {
    release()
    openInbox()
  })
  n.show()
}

// Every window's sidebar watches the same computers and finds a grant within a minute of each
// other, so one is announced once here. Only for a while: lost and given back later is news again.
const announcedShares = new Map<string, number>()
const SHARE_DEDUPE_MS = 5 * 60_000
const MAX_ANNOUNCED_SHARES = 500
// The renderer writes these; a longer one is not a notice this app wrote.
const MAX_SHARE_KEY = 256
const MAX_SHARE_TITLE = 200
const MAX_SHARE_BODY = 400

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/**
 * A teammate let this person use (or manage) one of their computers. When the window that found
 * it is focused, it says it in a toast instead; otherwise a notification opens Computers & runtimes.
 */
export function notifyComputerShared(args: {
  key: string
  title: string
  body: string
  teamId: string
  parentWindow?: BrowserWindow | null
}): 'notification' | 'in-app' | 'duplicate' {
  const { key, teamId, parentWindow } = args
  const title = clip(args.title, MAX_SHARE_TITLE)
  const body = clip(args.body, MAX_SHARE_BODY)
  // Raised for the account in use now; clicked maybe after a switch.
  const owner = accountOf(authSession.context())
  const now = Date.now()

  if (key.length > MAX_SHARE_KEY) throw new RangeError('Notice key too long')
  for (const [seen, at] of announcedShares)
    if (now - at > SHARE_DEDUPE_MS) announcedShares.delete(seen)
  if (announcedShares.has(key)) return 'duplicate'
  announcedShares.set(key, now)
  for (const oldest of announcedShares.keys()) {
    if (announcedShares.size <= MAX_ANNOUNCED_SHARES) break
    announcedShares.delete(oldest)
  }
  if (!Notification.isSupported()) return 'in-app'
  // Only the asking window shows its toast: another focused window would never see it.
  if (parentWindow?.isFocused()) return 'in-app'
  const n = new Notification({ title, body })
  const release = retainNotification(n)

  n.on('close', release)
  n.on('click', () => {
    release()
    // The link opens Computers in the notice's team, whichever one is on screen by now.
    const open = () => openAppPath(`/teams/${encodeURIComponent(teamId)}/agents`)

    // Since raised, the app moved to another account: back to this one first.
    if (owner && accountOf(authSession.context()) !== owner) void openAsAccount(owner, open)
    else void open()
  })
  n.show()

  return 'notification'
}
