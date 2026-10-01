import { POSTHOG_REGION_LABELS } from '../types/posthog.ts'

import type { PosthogIntegration, PosthogRegion } from '../types/posthog.ts'

type Connection = Pick<PosthogIntegration, 'id' | 'label' | 'region'>

/** An existing binding a new connect would likely duplicate: same label (case-insensitive) first, then same region. */
export function findDuplicateConnection<T extends Connection>(
  integrations: T[],
  label: string,
  region: PosthogRegion,
): T | null {
  const wanted = label.trim().toLowerCase()
  const sameLabel = wanted
    ? integrations.find((item) => item.label.trim().toLowerCase() === wanted)
    : undefined

  return sameLabel ?? integrations.find((item) => item.region === region) ?? null
}

export function duplicateNotice(connection: Connection): string {
  return `A PostHog connection named ${connection.label} (${POSTHOG_REGION_LABELS[connection.region]}) already exists.`
}

export function connectedMessage(
  existing: Connection[],
  bindingId: string,
  fallbackLabel: string,
): string {
  const match = existing.find((item) => item.id === bindingId)

  return match ? `Updated the existing connection ${match.label}` : `Connected ${fallbackLabel}`
}
