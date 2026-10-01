// Pure outcome/wording for the menu-driven "Check for Updates…" flow, kept
// apart from updater.ts so it is testable without electron.

export type InteractiveCheckOutcome =
  | { kind: 'dev' }
  | { kind: 'busy' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'update'; version: string }
  | { kind: 'error'; message: string }

export function checkOutcome(
  currentVersion: string,
  latestVersion: string | undefined,
): InteractiveCheckOutcome {
  if (latestVersion && latestVersion !== currentVersion) {
    return { kind: 'update', version: latestVersion }
  }

  return { kind: 'up-to-date', version: currentVersion }
}

export function describeCheckOutcome(outcome: InteractiveCheckOutcome): {
  type: 'info' | 'error'
  message: string
  detail?: string
} {
  switch (outcome.kind) {
    case 'dev':
      return { type: 'info', message: 'Updates are disabled in development builds.' }
    case 'busy':
      return { type: 'info', message: 'An update check is already running.' }
    case 'up-to-date':
      return {
        type: 'info',
        message: "You're up to date",
        detail: `Nuphos ${outcome.version} is the latest version.`,
      }
    case 'update':
      return {
        type: 'info',
        message: `Nuphos ${outcome.version} is available`,
        detail: 'It is downloading in the background and will install when you quit the app.',
      }
    case 'error':
      return { type: 'error', message: 'Update check failed', detail: outcome.message }
  }
}
