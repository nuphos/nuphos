// Pure outcome/wording for the menu-driven "Check for Updates…" flow, kept
// apart from updater.ts so it is testable without electron.

export type InteractiveCheckOutcome =
  | { kind: 'up-to-date'; version: string }
  | { kind: 'update'; version: string }
  | { kind: 'ready'; version: string }
  | { kind: 'error' }

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
  message: string
  detail: string
  confirmLabel?: string
} {
  switch (outcome.kind) {
    case 'up-to-date':
      return {
        message: "You're up to date",
        detail: `Nuphos ${outcome.version} is the latest version.`,
      }
    case 'update':
      return {
        message: `Downloading Nuphos ${outcome.version}`,
        detail: 'When it is ready, a Restart button appears in the sidebar.',
      }
    case 'ready':
      return {
        message: `Nuphos ${outcome.version} is ready`,
        detail: 'Restart now to finish updating, or it installs the next time you quit.',
        confirmLabel: 'Restart',
      }
    case 'error':
      // The raw updater error goes to telemetry; people get one plain sentence.
      return {
        message: "Couldn't check for updates",
        detail: 'Check your connection and try again later.',
      }
  }
}
