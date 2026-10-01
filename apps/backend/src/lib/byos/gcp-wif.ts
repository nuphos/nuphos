import { IdentityPoolClient } from 'google-auth-library'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { awsOidcSubjectForTeam, isAwsOidcConfigured, mintNuphosOidcToken } from './aws-oidc'

/**
 * GCP workload identity federation for the BYOS connector.
 *
 * Unlike the other clouds, the pool and provider live in *Nuphos's* GCP project:
 * an IAM policy may name a principal from any project, so the customer builds no
 * pool — they just grant Token Creator to the principal below, as they always did.
 *
 * Google validates the grant's baked-in `subject` against the token's `sub`, so a
 * token minted for team A cannot impersonate team B's service account — the check
 * lives in IAM, as the AWS role trust policy does.
 *
 * Two hops, both owned by `IdentityPoolClient`: mint a per-team RS256 token from
 * the shared Nuphos issuer, trade it at STS, then impersonate the customer's
 * account — re-minting through the supplier as tokens expire.
 */

const STS_TOKEN_URL = 'https://sts.googleapis.com/v1/token'
const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'

export const GCP_WIF_SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

/**
 * Whether federation is usable: both the pool coordinates and the shared Nuphos
 * signing key must be present, since the pool is worthless without a token to
 * present to it.
 */
export function gcpWifConfigured(): boolean {
  const { projectNumber, poolId, providerId } = config.byos.gcp.wif

  return Boolean(projectNumber && poolId && providerId) && isAwsOidcConfigured()
}

/**
 * The STS audience — the provider's own resource path. Unlike the other clouds,
 * whose audience is a fixed cloud constant, GCP derives it from our pool, so it
 * is one constant for all teams but only known at runtime.
 */
export function gcpWifAudience(): string {
  const { projectNumber, poolId, providerId } = config.byos.gcp.wif

  if (!projectNumber || !poolId || !providerId) {
    throw new AppError(
      503,
      'gcp_connector_unavailable',
      'GCP workload identity federation is not configured (set GCP_BYOS_WIF_PROJECT_NUMBER, GCP_BYOS_WIF_POOL_ID and GCP_BYOS_WIF_PROVIDER_ID).',
    )
  }

  return `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`
}

/**
 * The IAM principal a customer grants Service Account Token Creator to. This is
 * the one value the onboarding wizard asks them to paste, so it is also what the
 * bind-info endpoint returns.
 */
export function gcpWifPrincipalForTeam(teamId: string): string {
  const { projectNumber, poolId } = config.byos.gcp.wif

  if (!projectNumber || !poolId) {
    throw new AppError(
      503,
      'gcp_connector_unavailable',
      'GCP workload identity federation is not configured (set GCP_BYOS_WIF_PROJECT_NUMBER and GCP_BYOS_WIF_POOL_ID).',
    )
  }

  return `principal://iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/subject/${awsOidcSubjectForTeam(teamId)}`
}

// One federating client per team. They hold the STS token, so sharing one across
// teams would hand every team the first team's identity.
const clientsByTeam = new Map<string, IdentityPoolClient>()

/**
 * The federated source client for a team. Callers impersonate the customer's
 * service account directly from it.
 */
export function gcpWifSourceClient(teamId: string): IdentityPoolClient {
  const cached = clientsByTeam.get(teamId)

  if (cached) return cached

  const audience = gcpWifAudience()
  const client = new IdentityPoolClient({
    audience,
    subject_token_type: SUBJECT_TOKEN_TYPE,
    token_url: STS_TOKEN_URL,
    scopes: GCP_WIF_SCOPES,
    subject_token_supplier: {
      // Minted fresh per call: these are 5-minute tokens and the client only
      // asks when its own STS token needs replacing.
      getSubjectToken: () => Promise.resolve(mintNuphosOidcToken(teamId, audience)),
    },
  })

  clientsByTeam.set(teamId, client)

  return client
}

/** Test seam — the per-team client cache outlives config changes otherwise. */
export function resetGcpWifClientsForTest(): void {
  clientsByTeam.clear()
}
