import { AppError } from '@/lib/errors'

// Provider-agnostic sweep timeouts live next to the Aliyun sweep helpers.
import { SWEEP_READ_TIMEOUT_MS } from './aliyun-sweep'
import { awsOidcSubjectForTeam } from './aws-oidc'
import { signHuaweiRequest } from './huawei-signer'

import type { HuaweiHandle, HuaweiIdentity } from './huawei'

const IAM_HOST = 'iam.myhuaweicloud.com'

const ASSUME_ACTION = 'sts:agencies:assumeWithOIDC'

type AgencyStatement = {
  Effect?: 'Allow' | 'Deny'
  Action?: string | string[]
  Principal?: { Federated?: string | string[] }
  Condition?: { StringEquals?: Record<string, string | string[]> }
}

/** Best-effort upstream detail for an error message; IAM answers with JSON. */
function upstreamDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error_msg?: string; error?: { message?: string } }

    return parsed.error_msg ?? parsed.error?.message ?? body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []

  return Array.isArray(value) ? value : [value]
}

/**
 * Whether a policy action string grants `ASSUME_ACTION`, including prefix
 * wildcards (`*`, `sts:*`, `sts:agencies:*`) — a policy author who wrote a
 * broader action grant is still granting this one.
 */
function actionGrants(pattern: string): boolean {
  if (pattern === ASSUME_ACTION) return true
  if (!pattern.endsWith('*')) return false

  return ASSUME_ACTION.startsWith(pattern.slice(0, -1))
}

/** Whether this statement grants or denies `sts:agencies:assumeWithOIDC` to `expectedProviderUrn`. */
function statementApplies(statement: AgencyStatement, expectedProviderUrn: string): boolean {
  const principals = toArray(statement.Principal?.Federated)
  const actions = toArray(statement.Action)

  return principals.includes(expectedProviderUrn) && actions.some(actionGrants)
}

/** Whether an applicable statement restricts its trust to exactly `subject` — nothing broader. */
function statementIsRestrictedToSubject(statement: AgencyStatement, subject: string): boolean {
  const values = toArray(statement.Condition?.StringEquals?.['oidc:sub'])

  return values.length === 1 && values[0] === subject
}

/**
 * Find the trust agency by name among the account's agencies (ListAgenciesV5
 * has no name filter, so this pages through — bounded, since an account
 * plausibly has dozens of agencies, not thousands) and return its trust
 * policy, signed with the just-assumed session's own credentials.
 */
async function fetchAgencyTrustPolicy(
  handle: HuaweiHandle,
  agencyName: string,
): Promise<string | null> {
  let marker: string | undefined

  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://${IAM_HOST}/v5/agencies`)

    url.searchParams.set('limit', '200')
    if (marker) url.searchParams.set('marker', marker)

    const resp = await fetch(url, {
      headers: signHuaweiRequest('GET', url, handle),
      signal: AbortSignal.timeout(SWEEP_READ_TIMEOUT_MS),
    })

    if (!resp.ok) {
      throw new AppError(
        502,
        'huawei_federation_failed',
        `Huawei Cloud refused to list trust agencies (HTTP ${String(resp.status)}): ${upstreamDetail(await resp.text())}`,
      )
    }

    const { agencies, page_info: pageInfo } = (await resp.json()) as {
      agencies?: { agency_name: string; trust_policy?: string }[]
      page_info?: { next_marker?: string }
    }
    const found = (agencies ?? []).find((a) => a.agency_name === agencyName)

    if (found) return found.trust_policy ?? null
    if (!pageInfo?.next_marker) return null
    marker = pageInfo.next_marker
  }

  return null
}

/**
 * Confirm the trust agency's own policy restricts assumption to this team's
 * subject — a successful `AssumeAgencyWithOIDC` proves this team can assume
 * it, not that other Nuphos teams (who share the same issuer and audience)
 * cannot. Runs once at bind time, with the credentials just obtained.
 */
export async function verifyTeamSpecificTrust(
  handle: HuaweiHandle,
  identity: HuaweiIdentity,
  teamId: string,
  providerUrn: string,
): Promise<void> {
  const trustPolicyJson = await fetchAgencyTrustPolicy(handle, identity.agencyName)

  if (!trustPolicyJson) {
    throw new AppError(
      400,
      'huawei_identity_not_usable',
      `Could not find trust agency "${identity.agencyName}" to verify its trust policy.`,
    )
  }

  const policy = JSON.parse(trustPolicyJson) as { Statement?: AgencyStatement[] }
  const subject = awsOidcSubjectForTeam(teamId)
  const applicable = (policy.Statement ?? []).filter((s) => statementApplies(s, providerUrn))
  const allows = applicable.filter((s) => s.Effect !== 'Deny')
  const denies = applicable.filter((s) => s.Effect === 'Deny')
  // Every Allow path that grants this provider must restrict to exactly this
  // team's subject — one narrow statement is not enough if another, broader
  // Allow statement also grants the same shared provider unconditionally.
  // A Deny statement targeting this provider (any subject) means untrusted:
  // Nuphos cannot know it doesn't apply to this team without evaluating the
  // full policy language, so it fails closed.
  const trusted =
    denies.length === 0 &&
    allows.length > 0 &&
    allows.every((s) => statementIsRestrictedToSubject(s, subject))

  if (!trusted) {
    throw new AppError(
      400,
      'huawei_identity_not_usable',
      `Trust agency "${identity.agencyName}" does not condition its trust policy on oidc:sub = "${subject}" for identity provider "${identity.idpId}" alone — Nuphos's identity provider is shared across every customer, so every statement granting sts:agencies:assumeWithOIDC to it must carry that exact condition, with no broader or conflicting statement. Fix the agency's trust policy.`,
    )
  }
}
