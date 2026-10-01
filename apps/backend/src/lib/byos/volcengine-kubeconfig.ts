import { AppError } from '@/lib/errors'

import { VKE_VERSION, volcCall, volcErrorCode, withVolcRateLimitRetry } from './volcengine-api'

import type { KubeconfigResult } from './kubeconfig'
import type { VolcengineHandle } from './volcengine-api'

type RawKubeconfig = {
  Id?: string
  ClusterId?: string
  Type?: string
  Kubeconfig?: string
  ExpireTime?: string
}

/** Decode VKE's kubeconfig payload — the API returns it base64-encoded. */
function decodeKubeconfig(raw: string): string {
  if (raw.includes('apiVersion')) return raw
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8')

    if (decoded.includes('apiVersion')) return decoded
  } catch {
    // fall through — return the raw payload and let kubectl complain
  }

  return raw
}

/**
 * Produce a working kubeconfig for a VKE cluster.
 *
 * VKE kubeconfigs are issued per caller: ListKubeconfigs returns the caller's
 * existing ones, CreateKubeconfig issues a new credential. We only request the
 * PUBLIC variant — issuing a caller credential is fine from this path, but
 * enabling the cluster's public API endpoint is a network change and must stay
 * a deliberate console action (mirrors the TKE/ACK adapters).
 */
export async function generateVkeKubeconfig(
  handle: VolcengineHandle,
  region: string,
  clusterId: string,
  // `fresh` skips reuse and issues a NEW credential. Needed because VKE
  // materializes in-cluster RBAC bindings at kubeconfig ISSUE time — a role
  // authorization granted later never applies to already-issued kubeconfigs,
  // so "grant, then retry with the old credential" 403s forever. Existing
  // kubeconfigs are deliberately NOT deleted (other replicas may hold them;
  // they expire on their own).
  opts: { fresh?: boolean } = {},
): Promise<KubeconfigResult | null> {
  const listMine = () =>
    withVolcRateLimitRetry(() =>
      volcCall<{ Items?: RawKubeconfig[] }>(
        handle,
        'vke',
        region,
        'ListKubeconfigs',
        VKE_VERSION,
        { Filter: { ClusterIds: [clusterId], Types: ['Public'] }, PageNumber: 1, PageSize: 10 },
        { json: true },
      ),
    )
  const issueOne = () =>
    withVolcRateLimitRetry(() =>
      volcCall<{ Id?: string }>(
        handle,
        'vke',
        region,
        'CreateKubeconfig',
        VKE_VERSION,
        // Valid for a year; VKE treats ValidDuration in hours.
        { ClusterId: clusterId, Type: 'Public', ValidDuration: 24 * 365 },
        { json: true },
      ),
    )

  try {
    let items: RawKubeconfig[]
    let withConfig: RawKubeconfig | undefined

    if (opts.fresh) {
      // The whole point of fresh is a NEW credential (post-grant RBAC) —
      // falling back to an older kubeconfig would silently defeat it and keep
      // the caller on a credential that still 403s. The re-list can lag the
      // create, so retry briefly and fail loudly rather than fall back.
      const freshId = (await issueOne())?.Id

      for (let attempt = 0; attempt < 4 && !withConfig; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt))
        items = (await listMine())?.Items ?? []
        withConfig = items.find((k) => k.Id === freshId && k.Kubeconfig)
      }
      if (!withConfig?.Kubeconfig) {
        throw new AppError(
          502,
          'volcengine_kubeconfig_not_ready',
          'VKE issued a fresh kubeconfig but did not return it in time — retry in a few seconds.',
          { provider: 'volcengine', clusterId },
        )
      }
    } else {
      items = (await listMine())?.Items ?? []
      if (items.length === 0 || !items.some((k) => k.Kubeconfig)) {
        // No public kubeconfig issued to this caller yet — issue one, then
        // re-list to fetch it.
        await issueOne()
        items = (await listMine())?.Items ?? []
      }
      withConfig = items.find((k) => k.Kubeconfig)
    }
    if (!withConfig?.Kubeconfig) {
      throw new AppError(
        409,
        'volcengine_endpoint_not_enabled',
        'The VKE cluster returned no public kubeconfig — its public API server endpoint is likely not enabled. Enable public access in the Volcengine console, then retry.',
        { provider: 'volcengine', clusterId },
      )
    }
    // VKE returns the credential's real ExpireTime; use it so the
    // X-Kubeconfig-Expires-At header is accurate and clients don't refresh
    // early. Fall back to a conservative 14-min window only when it's missing
    // or unparseable.
    const parsedExpiry = withConfig.ExpireTime ? new Date(withConfig.ExpireTime) : null

    return {
      kubeconfig: decodeKubeconfig(withConfig.Kubeconfig),
      expiresAt:
        parsedExpiry && !Number.isNaN(parsedExpiry.getTime())
          ? parsedExpiry
          : new Date(Date.now() + 14 * 60 * 1000),
    }
  } catch (e) {
    if (e instanceof AppError) throw e
    if (/NotFound|ClusterNotFound/i.test(volcErrorCode(e))) return null
    if (
      /PublicAccess|Endpoint|NotSupported/i.test(
        `${volcErrorCode(e)} ${(e as Error).message ?? ''}`,
      )
    ) {
      throw new AppError(
        409,
        'volcengine_endpoint_not_enabled',
        "The VKE cluster's public API server endpoint is not enabled. Enable public access in the Volcengine console, then retry.",
        { provider: 'volcengine', clusterId },
      )
    }
    throw e
  }
}
