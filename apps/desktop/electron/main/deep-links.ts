import { app, BrowserWindow, ipcMain } from 'electron'

import { isConnectAgentLink, parseConnectAgentLink } from '../../src/lib/connectAgentLink'
import * as agentChatDeepLink from '../agent-chat-deeplink'
import { captureMain } from '../analytics'
import * as appOpenDeepLink from '../app-open-deeplink'
import * as asanaInstall from '../asana-install'
import * as cloudflareInstall from '../cloudflare-install'
import * as discordInstall from '../discord-install'
import * as githubInstall from '../github-install'
import * as gitlabInstall from '../gitlab-install'
import * as jiraInstall from '../jira-install'
import * as linearInstall from '../linear-install'
import * as posthogInstall from '../posthog-install'
import * as sentryInstall from '../sentry-install'
import * as slackInstall from '../slack-install'

import { createDeepLinkDelivery } from './deep-link-delivery'

import type { DeepLinkTarget } from './deep-link-delivery'

type DeepLinkWindowHooks = {
  focusedAppWindow: () => BrowserWindow | null
  showMainWindow: () => BrowserWindow
}

let windowHooks: DeepLinkWindowHooks | null = null

export function initDeepLinkWindowHooks(hooks: DeepLinkWindowHooks) {
  windowHooks = hooks
}

function deepLinkTarget(win: BrowserWindow | null | undefined): DeepLinkTarget | null {
  if (!win || win.isDestroyed()) return null

  return {
    isLoading: () => win.webContents.isLoading(),
    send: (channel, envelope) => win.webContents.send(channel, envelope),
  }
}

function fallbackDeepLinkTarget(): DeepLinkTarget | null {
  return deepLinkTarget(windowHooks?.focusedAppWindow() ?? null)
}

export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (githubInstall.isCallbackUrl(arg)) return arg
    if (gitlabInstall.isCallbackUrl(arg)) return arg
    if (cloudflareInstall.isCallbackUrl(arg)) return arg
    if (linearInstall.isCallbackUrl(arg)) return arg
    if (jiraInstall.isCallbackUrl(arg)) return arg
    if (asanaInstall.isCallbackUrl(arg)) return arg
    if (sentryInstall.isCallbackUrl(arg)) return arg
    if (posthogInstall.isCallbackUrl(arg)) return arg
    if (slackInstall.isCallbackUrl(arg)) return arg
    if (discordInstall.isCallbackUrl(arg)) return arg
    if (agentChatDeepLink.isAgentChatUrl(arg)) return arg
    if (appOpenDeepLink.isAppOpenUrl(arg)) return arg
    if (isConnectAgentLink(arg)) return arg
  }

  return null
}

// The renderer attaches its deep-link IPC listeners from a React effect long
// after did-finish-load (and only once the user is logged in), so a payload can
// always arrive with nobody listening. Delivery therefore runs on the
// renderer's ack, not on main's guess about who is ready — see
// `deep-link-delivery.ts` for why the old readiness flag lost deep links.
const delivery = createDeepLinkDelivery(fallbackDeepLinkTarget)

export function flushPendingDeepLinks(targetWindow?: BrowserWindow) {
  delivery.flush(deepLinkTarget(targetWindow))
}

// Sent by the preload the moment a deep-link handler is attached — an
// accelerator so a queued payload lands on the next tick instead of waiting out
// the retry interval. It can never block delivery.
ipcMain.on('deep-link:subscriber-ready', (event) => {
  flushPendingDeepLinks(BrowserWindow.fromWebContents(event.sender) ?? undefined)
})

ipcMain.on('deep-link:ack', (_event, deliveryId: unknown) => {
  delivery.ack(deliveryId)
})

// Raising the window is the visible half of following a deep link, so do it
// even when the payload has to wait for a listener. Before `ready` there is no
// window to raise yet; the queue survives until there is.
function queueDeepLink(channel: string, payload: unknown) {
  const win = app.isReady() && windowHooks ? windowHooks.showMainWindow() : null

  delivery.enqueue(channel, payload, deepLinkTarget(win))
}

// Single path for deep links so both delivery routes (open-url on macOS,
// second-instance on Windows/Linux) emit the same event.
export function handleDeepLink(url: string) {
  if (githubInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'github_callback' })
    void githubInstall.handleCallback(url)

    return
  }
  if (gitlabInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'gitlab_callback' })
    void gitlabInstall.handleCallback(url)

    return
  }
  if (cloudflareInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'cloudflare_callback' })
    void cloudflareInstall.handleCallback(url)

    return
  }
  if (linearInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'linear_callback' })
    void linearInstall.handleCallback(url)

    return
  }
  if (jiraInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'jira_callback' })
    void jiraInstall.handleCallback(url)

    return
  }
  if (asanaInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'asana_callback' })
    void asanaInstall.handleCallback(url)

    return
  }
  if (sentryInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'sentry_callback' })
    void sentryInstall.handleCallback(url)

    return
  }
  if (posthogInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'posthog_callback' })
    posthogInstall.handleCallback(url)

    return
  }
  if (slackInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'slack_callback' })
    void slackInstall.handleCallback(url)

    return
  }
  if (discordInstall.isCallbackUrl(url)) {
    captureMain('deep_link_opened', { kind: 'discord_callback' })
    void discordInstall.handleCallback(url)

    return
  }
  if (agentChatDeepLink.isAgentChatUrl(url)) {
    const payload = agentChatDeepLink.parseAgentChatUrl(url)

    if (!payload) return
    captureMain('deep_link_opened', {
      kind: 'agent_chat',
      file_count: payload.files.length,
      source: payload.source,
      has_team_id: Boolean(payload.teamId),
      auto_send: payload.autoSend,
    })
    queueDeepLink('deep-link:agent-chat', payload)

    return
  }
  if (appOpenDeepLink.isAppOpenUrl(url)) {
    const payload = appOpenDeepLink.parseAppOpenUrl(url)

    if (!payload) return
    const sanitizedPath = payload.path.split(/[?#]/, 1)[0] || '/'

    captureMain('deep_link_opened', {
      kind: 'app_open',
      path: sanitizedPath,
    })
    queueDeepLink('deep-link:app-open', payload)

    return
  }
  if (isConnectAgentLink(url)) {
    const payload = parseConnectAgentLink(url)

    captureMain('deep_link_opened', { kind: 'connect_agent', valid: Boolean(payload) })
    if (payload) queueDeepLink('deep-link:connect-agent', payload)
  }
}
