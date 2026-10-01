import { CopyableValue, StepNote } from './shared'

import type { GcpWifInfo } from '../../types'

// The one field in the whole GCP setup where the customer pastes OUR identity
// rather than theirs. The value and explanation live here and are rendered by
// the project-scope and first-run wizards alike.

/**
 * Nuphos's principal for the Token Creator grant. Prefers the team's workload
 * identity subject, which Google pins to this team: a token minted for another
 * team cannot use the grant, so the customer's own IAM policy — not our code —
 * is what keeps teams apart.
 *
 * A deploy without federation cannot bind GCP accounts. Never guesses: a wrong
 * principal here produces a grant that silently does nothing.
 */
export function GcpTokenCreatorPrincipal({ wif }: { wif: GcpWifInfo | null }) {
  if (!wif) return <span className="text-tertiary italic">loading…</span>

  if (!wif.configured || !wif.principal) {
    return <span className="text-error">Workload identity federation is unavailable.</span>
  }

  return <CopyableValue value={wif.principal} />
}

/** The aside under that field, matched to whichever principal was rendered. */
export function GcpTokenCreatorNote({ wif, saName }: { wif: GcpWifInfo | null; saName: string }) {
  if (wif && !wif.configured) {
    return <StepNote>GCP account binding is unavailable until WIF is configured.</StepNote>
  }

  return (
    <StepNote>
      That principal is <span className="text-main">Nuphos&apos;s own</span> — the one field in this
      setup where you paste our identity instead of yours. It is scoped to your team, so it is the
      only Nuphos identity that can use this grant. Token Creator lets it{' '}
      <span className="text-main">act as</span> {saName} for minutes at a time and nothing else; it
      gives that account no new power of its own, and Nuphos holds no key. Watch the Role field: it
      opens on <span className="text-main">Service Account Admin</span>, which is a different thing.
    </StepNote>
  )
}
