import { CLOUDFLARE_SCOPE_CATEGORIES } from './cloudflare-scopes'
import { parseAtlasError } from '../../api'

export type Provider =
  | 'aws'
  | 'gcp'
  | 'cloudflare'
  | 'linode'
  | 'hetzner'
  | 'betterstack'
  | 'uptime-kuma'
  | 'tailscale'
  | 'zeabur'
  | 'vanta'
  | 'secureframe'
  | 'notion'
  | 'upstash'
  | 'resend'
  | 'tencent'
  | 'aliyun'
  | 'volcengine'
  | 'huawei'
  | 'azure'

// Each Cloudflare scope category gets one Off / Read / Write choice. Read
// requests the category's read-only scopes; Write requests every scope in it.
export type CloudflareScopeAccess = 'off' | 'read' | 'write'

export type CloudflareScopeKey = (typeof CLOUDFLARE_SCOPE_CATEGORIES)[number]['key']

export const CLOUDFLARE_DEFAULT_SCOPE_ACCESS = Object.fromEntries(
  CLOUDFLARE_SCOPE_CATEGORIES.map((c) => [
    c.key,
    c.key === 'dns_and_zones' || c.key === 'developer_platform' ? 'write' : 'off',
  ]),
) as Record<CloudflareScopeKey, CloudflareScopeAccess>

const READ_ONLY_SCOPE = /\.(read|metadata_read)$/

// Always-requested baseline: account/user/memberships for account discovery,
// zone.read so the DNS view can list zones, plus offline_access (added
// server-side) for refresh tokens.
const CLOUDFLARE_BASELINE_SCOPES = [
  'account-settings.read',
  'user-details.read',
  'memberships.read',
  'zone.read',
]

export function cloudflareScopesFor(
  access: Record<CloudflareScopeKey, CloudflareScopeAccess>,
): string[] {
  const selected = CLOUDFLARE_SCOPE_CATEGORIES.flatMap((c): readonly string[] => {
    if (access[c.key] === 'write') return c.scopes
    if (access[c.key] === 'read') return c.scopes.filter((s) => READ_ONLY_SCOPE.test(s))

    return []
  })

  return [...new Set([...selected, ...CLOUDFLARE_BASELINE_SCOPES])]
}

// Volcengine role TRN, e.g. trn:iam::2100000000:role/NuphosConnector.
export const TRN_PATTERN = /^trn:iam::\d+:role\/.+$/
// Huawei Cloud account (IAM domain) id, the IAM identity provider name, and
// the trust agency name assigned to Nuphos's audience.
export const HUAWEI_DOMAIN_ID_PATTERN = /^[0-9a-f]{32}$/i
export const HUAWEI_IDP_NAME_PATTERN = /^[\w.-]{1,64}$/
export const HUAWEI_AGENCY_NAME_PATTERN = /^[\w.-]{1,64}$/
// Azure tenant / client / subscription ids are all GUIDs.
// Alibaba Cloud RAM role ARN + OIDC provider ARN.
export const ALIYUN_ROLE_ARN_PATTERN = /^acs:ram::\d+:role\/.+$/
export const ALIYUN_OIDC_PROVIDER_ARN_PATTERN = /^acs:ram::\d+:oidc-provider\/.+$/
// Tencent CAM role ARN, e.g. qcs::cam::uin/123456789:roleName/Nuphos.
export const TENCENT_ROLE_ARN_PATTERN = /^qcs::cam::uin\/\d+:role(Name)?\/.+$/

export function errorMessage(e: unknown): string {
  // parseAtlasError unwraps the __ATLAS_API_ERROR__ sentinel the main process
  // wraps API failures in (returning the backend's clean message); the replace
  // strips the Electron IPC prefix from any plain, non-sentinel error.
  return parseAtlasError(e).message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
}
