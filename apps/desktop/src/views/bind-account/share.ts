/** The providers whose connect step sends the member's share choice. */
export const SHAREABLE_PROVIDERS = new Set<string>([
  'linode',
  'hetzner',
  'betterstack',
  'uptime-kuma',
  'tailscale',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'vanta',
  'secureframe',
  'notion',
  'upstash',
  'resend',
])

/** Connections the backend keeps private even when the team shares new ones by default. */
export const HIGH_PRIVILEGE_PROVIDERS = new Set<string>([
  'aws',
  'gcp',
  'azure',
  'tencent',
  'aliyun',
  'volcengine',
  'huawei',
  'linode',
  'hetzner',
  'tailscale',
  'upstash',
  'cloudflare',
])
