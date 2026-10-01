// Console screenshots for the guided cloud setups: one file per cloud under
// `cloud-bind-screenshots/`, and this file as the lookup the wizards call. That
// is the axis the library grows along — a console redesign is one provider's
// problem, and nobody re-shooting the Azure portal should read past AWS first.
//
// Deliberately sparse. A screenshot earns its place only where the instruction
// is "find this control on a dense page" — the three consoles each get
// redesigned on their own schedule, nothing in CI can detect a stale one, and a
// screenshot that no longer matches is worse than none because it convinces the
// user they are on the wrong page. Simple forms and our own fields get nothing.

import { AWS_SCREENSHOTS } from './cloud-bind-screenshots/aws'
import { AZURE_SCREENSHOTS } from './cloud-bind-screenshots/azure'
import { GCP_SCREENSHOTS } from './cloud-bind-screenshots/gcp'

import type { ProviderScreenshots, SetupScreenshot } from './cloud-bind-screenshots/types'

export type { SetupScreenshot } from './cloud-bind-screenshots/types'

const BY_PROVIDER: Partial<Record<string, ProviderScreenshots>> = {
  aws: AWS_SCREENSHOTS,
  gcp: GCP_SCREENSHOTS,
  azure: AZURE_SCREENSHOTS,
}

const NO_SCREENSHOTS: readonly SetupScreenshot[] = []

/** Console screenshots for a connection step, or none. */
export function setupScreenshotsFor(
  provider: string,
  stepTitle: string,
  _purpose: 'operational',
): readonly SetupScreenshot[] {
  const table = BY_PROVIDER[provider]

  if (!table) return NO_SCREENSHOTS

  const forPurpose = table.operational

  return forPurpose[stepTitle] ?? NO_SCREENSHOTS
}
