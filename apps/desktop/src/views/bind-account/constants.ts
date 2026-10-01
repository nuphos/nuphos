import {
  faBolt,
  faDatabase,
  faGlobe,
  faHardDrive,
  faKey,
  faLayerGroup,
} from '@fortawesome/free-solid-svg-icons'

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

// Common Cloudflare resources the user picks access for before authorizing.
// `scope` is the Cloudflare OAuth scope base; we append .read or .write per the
// chosen access level (Cloudflare treats .write as "see and change"). Cloudflare
// self-managed OAuth clients use dot+hyphen scope strings (e.g. `dns.write`),
// not the underscore/colon form wrangler uses.
export type CloudflareScopeAccess = 'off' | 'read' | 'write'

// Each resource maps to one or more scope bases (zone listing for DNS rides the
// always-requested zone.read baseline; Workers also needs workers-routes for the
// account-level custom domains view).
export const CLOUDFLARE_SCOPE_RESOURCES = [
  { key: 'dns', label: 'DNS', hint: 'Zones & records', icon: faGlobe, scopes: ['dns'] },
  {
    key: 'workers',
    label: 'Workers',
    hint: 'Scripts & cron',
    icon: faBolt,
    scopes: ['workers-scripts', 'workers-routes'],
  },
  {
    key: 'pages',
    label: 'Pages',
    hint: 'Projects & deploys',
    icon: faLayerGroup,
    scopes: ['page'],
  },
  { key: 'r2', label: 'R2', hint: 'Buckets & objects', icon: faHardDrive, scopes: ['workers-r2'] },
  { key: 'd1', label: 'D1', hint: 'Databases', icon: faDatabase, scopes: ['d1'] },
  {
    key: 'kv',
    label: 'KV',
    hint: 'Namespaces & keys',
    icon: faKey,
    scopes: ['workers-kv-storage'],
  },
] as const

export type CloudflareScopeKey = (typeof CLOUDFLARE_SCOPE_RESOURCES)[number]['key']

// Always-requested baseline: account/user/memberships for account discovery,
// zone.read so the DNS view can list zones, plus offline_access (added
// server-side) for refresh tokens.
export const CLOUDFLARE_BASELINE_SCOPES = [
  'account-settings.read',
  'user-details.read',
  'memberships.read',
  'zone.read',
]

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
