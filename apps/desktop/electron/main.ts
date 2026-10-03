import path from 'node:path'

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'

import {
  initMainAnalytics,
  captureMain,
  captureMainException,
  shutdownMainAnalytics,
} from './analytics'
import * as asanaInstall from './asana-install'
import * as cloudflareInstall from './cloudflare-install'
import * as discordInstall from './discord-install'
import * as githubInstall from './github-install'
import * as gitlabInstall from './gitlab-install'
import * as jiraInstall from './jira-install'
import * as k8s from './k8s'
import * as linearInstall from './linear-install'
import { runtimeTerminals } from './runtime-terminal'
import { localTerminals } from './local-terminal'
import { registerAppProtocolHandler, registerAppScheme } from './main/app-protocol'
import { startChangelogPolling } from './main/changelog'
import { accountsChannels } from './main/channels-accounts'
import { agentChannels } from './main/channels-agent'
import { agentReadChannels } from './main/channels-agent-read'
import { appChannels } from './main/channels-app'
import { cloudInfraChannels } from './main/channels-cloud-infra'
import { cloudOpsChannels } from './main/channels-cloud-ops'
import { cloudflareChannels } from './main/channels-cloudflare'
import { cloudflareAppsChannels } from './main/channels-cloudflare-apps'
import { connectChannels } from './main/channels-connect'
import { deviceChannels } from './main/channels-device'
import { gitChannels } from './main/channels-git'
import { instructionsChannels } from './main/channels-instructions'
import { integrationsChannels } from './main/channels-integrations'
import { k8sChannels } from './main/channels-k8s'
import { localTerminalChannels } from './main/channels-local-terminal'
import { monitoringChannels } from './main/channels-monitoring'
import { posthogChannels } from './main/channels-posthog'
import { teamChannels } from './main/channels-team'
import {
  findDeepLinkInArgv,
  flushPendingDeepLinks,
  handleDeepLink,
  initDeepLinkWindowHooks,
} from './main/deep-links'
import { startDevBackendHealthProbe } from './main/dev-backend-health'
import { APP_NAME, devSuffix, isDev } from './main/env'
import { prepareFirstLaunch } from './main/first-launch'
import { initLocalRuntime, stopLocalRuntime } from './main/local-runtime'
import { installApplicationMenu } from './main/menu'
import { readPersistedThemeSource } from './main/theme'
import { initAutoUpdaterEvents, startUpdatePolling, stopUpdatePolling } from './main/updater'
import { initWebviewGuard } from './main/webview-guard'
import { createWindow, focusedAppWindow, showMainWindow } from './main/windows'
import * as podExec from './pod-exec'
import * as posthogInstall from './posthog-install'
import * as sentryInstall from './sentry-install'
import { resolveShellEnv } from './shell-env'
import * as slackInstall from './slack-install'
import * as terminal from './terminal'

export type { UpdaterState } from './main/updater'

initDeepLinkWindowHooks({ focusedAppWindow, showMainWindow })

// Electron implements elastic overscroll through a renderer-process switch.
// Set it before app readiness so shared renderer processes also receive it;
// a per-window scrollBounce preference can be missed when Chromium reuses a
// renderer that was launched for an earlier webContents.
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('scroll-bounce')
}

// Dev-only: expose a CDP remote-debugging port so an e2e harness (chrome-devtools
// MCP) can attach to the renderer. Gated behind ATLAS_DEV_CDP_PORT so prod is
// unaffected. Runs before app.whenReady() below; appendSwitch is a no-op after
// ready. NOTE: dev affordance — do NOT commit (git checkout this file to drop it).
if (process.env.ATLAS_DEV_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ATLAS_DEV_CDP_PORT)
}

// Crash visibility: route otherwise-fatal main-process errors to PostHog.
// Use uncaughtExceptionMonitor (not uncaughtException) so we observe the crash
// WITHOUT suppressing Node's default print-stack-and-exit behavior — adding a
// plain 'uncaughtException' listener would silently keep the process alive.
process.on('uncaughtExceptionMonitor', (err) => {
  captureMainException(err, { kind: 'uncaught_exception' })
})
// stdout/stderr are pipes to whoever launched us (the dev launcher, a
// terminal). When that end closes first, the next console.log raises EPIPE
// asynchronously on the stream — with no listener that is an uncaught
// exception and a crash dialog over a window that is otherwise fine.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EPIPE') throw err
  })
}
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
  captureMainException(reason, { kind: 'unhandled_rejection' })
})

app.setName(APP_NAME)
if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))
}

if (process.platform === 'darwin' && process.env.ATLAS_WT_BADGE) {
  app
    .whenReady()
    .then(() => {
      app.dock?.setBadge(process.env.ATLAS_WT_BADGE!)
    })
    .catch((e: unknown) => {
      console.error('[dock-badge]', e)
    })
}

registerAppScheme()

// Custom URL scheme used by the GitHub App setup redirect.
// Dev Electron identifies as com.github.electron, so do not steal the production
// nuphos:// handler unless a local deep-link test explicitly opts in.
if (!isDev) {
  app.setAsDefaultProtocolClient(githubInstall.GITHUB_PROTOCOL)
} else if (process.env.ATLAS_REGISTER_NUPHOS_PROTOCOL === '1' && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(githubInstall.GITHUB_PROTOCOL, process.execPath, [
    path.resolve(process.argv[1] ?? ''),
  ])
}

// Single-instance lock: required so deep-link relaunches on Windows / Linux are
// delivered to the running window via `second-instance` instead of starting a
// duplicate process.
const claimIntro = prepareFirstLaunch(app.getPath('userData'))
const gotInstanceLock = app.requestSingleInstanceLock()

if (!gotInstanceLock) {
  app.quit()
}

let firstLaunchPending = gotInstanceLock && (isDev || claimIntro())

ipcMain.handle('app:claimFirstLaunchIntro', () => {
  const showIntro = firstLaunchPending

  firstLaunchPending = false

  return showIntro
})

app.on('second-instance', (_event, argv) => {
  showMainWindow()
  const url = findDeepLinkInArgv(argv)

  if (url) handleDeepLink(url)
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

let quitCaptured = false
let quitTeardownRan = false
let nodeShellCleanupAwaited = false

app.on('before-quit', (e) => {
  if (!quitTeardownRan) {
    quitTeardownRan = true
    if (!quitCaptured) {
      quitCaptured = true
      captureMain('app_quit')
    }
    githubInstall.cancelAllPending()
    gitlabInstall.cancelAllPending()
    cloudflareInstall.cancelAllPending()
    linearInstall.cancelAllPending()
    jiraInstall.cancelAllPending()
    asanaInstall.cancelAllPending()
    sentryInstall.cancelAllPending()
    posthogInstall.cancelAllPending()
    slackInstall.cancelAllPending()
    discordInstall.cancelAllPending()
    k8s.stopAllPortForwards()
    terminal.closeAllSshSessions()
    localTerminals.closeAll()
    runtimeTerminals.closeAll()
    // Closes exec sessions and triggers deletion of any node-shell pods.
    podExec.closeAllPodExecSessions()
    stopUpdatePolling()
    // Fire-and-forget flush; the event loop stays alive long enough for the
    // single in-flight batch (flushAt: 1) to drain before exit.
    void shutdownMainAnalytics()
  }
  // Hold the quit briefly so in-flight node-shell pod deletions can land —
  // otherwise the app can exit before the API server removes a privileged pod.
  // Bounded by a timeout so quit never hangs; re-quit after it settles.
  if (!nodeShellCleanupAwaited) {
    nodeShellCleanupAwaited = true
    e.preventDefault()
    void Promise.allSettled([podExec.awaitNodeShellCleanup(2000), stopLocalRuntime()]).finally(() =>
      app.quit(),
    )
  }
})

app
  .whenReady()
  .then(async () => {
    // Before any window exists: web-contents-created only fires for contents
    // created after registration, so the guard must precede createWindow() or
    // the first window's webContents never gets the will-attach-webview hook.
    initWebviewGuard()
    // Warm the interactive-shell env cache so the first local exec doesn't pay
    // the shell-probe latency.
    void resolveShellEnv()
    initMainAnalytics()
    startDevBackendHealthProbe()
    initLocalRuntime()
    captureMain('app_launched', {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      is_dev: isDev,
    })
    nativeTheme.themeSource = readPersistedThemeSource()
    // When the OS appearance changes while themeSource follows it ('system'), the
    // renderer's own `matchMedia('prefers-color-scheme')` change event is
    // unreliable in Electron, so forward the native signal to every window. The
    // renderer decides whether to act on it (only when the preference is System).
    nativeTheme.on('updated', () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('app:nativeThemeUpdated', {
          shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
        })
      }
    })
    installApplicationMenu()
    if (isDev && devSuffix && process.platform === 'darwin') {
      app.dock?.setBadge(process.env.ATLAS_DEV_SUFFIX ?? '')
    }

    registerAppProtocolHandler()

    await k8s.init().catch((e: unknown) => {
      console.warn('initial kube auto-connect failed:', e)
    })
    createWindow()
    flushPendingDeepLinks()
    app.on('activate', () => {
      showMainWindow()
    })

    initAutoUpdaterEvents()

    startUpdatePolling()
    startChangelogPolling()
  })
  .catch((e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e))

    captureMainException(err, { kind: 'app_bootstrap_failed' })
    console.error('[bootstrap]', err)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const channels = {
  ...k8sChannels,
  ...appChannels,
  ...localTerminalChannels,
  ...teamChannels,
  ...accountsChannels,
  ...cloudflareChannels,
  ...cloudflareAppsChannels,
  ...monitoringChannels,
  ...integrationsChannels,
  ...posthogChannels,
  ...connectChannels,
  ...cloudInfraChannels,
  ...cloudOpsChannels,
  ...gitChannels,
  ...agentChannels,
  ...agentReadChannels,
  ...instructionsChannels,
  ...deviceChannels,
} as const

for (const [name, handler] of Object.entries(channels)) {
  ipcMain.handle(name, handler as never)
}
