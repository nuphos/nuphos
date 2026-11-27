// Claude Code lists every skill it loads on each model call. A provider's skill is
// listed only when the conversation selected a credential for that provider, so the
// runtime leaves the rest out of the session's plugin. The files stay on disk: a
// credential selected later names its skill's path in its setup hint.
const SKILL_PROVIDERS: Record<string, string[]> = {
  aws: ['aws'],
  'aws-ec2-ssh': ['aws'],
  gcloud: ['gcp'],
  'gcp-compute-engine-ssh': ['gcp'],
  firebase: ['gcp'],
  linode: ['linode'],
  hetzner: ['hetzner'],
  tencent: ['tencent'],
  aliyun: ['aliyun'],
  volcengine: ['volcengine'],
  azure: ['azure'],
  huawei: ['huawei'],
  asana: ['asana'],
  betterstack: ['betterstack'],
  cloudflare: ['cloudflare'],
  gitlab: ['gitlab'],
  grafana: ['grafana'],
  jira: ['jira'],
  linear: ['linear'],
  notion: ['notion'],
  plaud: ['plaud'],
  posthog: ['posthog'],
  resend: ['resend'],
  secureframe: ['secureframe'],
  sentry: ['sentry'],
  sonarqube: ['sonarqube'],
  tailscale: ['tailscale'],
  'tailnet-ssh': ['tailscale'],
  trello: ['trello'],
  upstash: ['upstash'],
  vanta: ['vanta'],
  zeabur: ['zeabur'],
  'google-workspace': ['gmail', 'google-drive', 'google-calendar'],
}

/** The provider skills a conversation with these selected credentials does not list. */
export function hiddenSkills(selected: { provider: string; id: string }[]): string[] {
  // A Personal Credential's id is its provider: github, linear, gmail, …
  const providers = new Set(selected.map((c) => (c.provider === 'personal' ? c.id : c.provider)))

  return Object.entries(SKILL_PROVIDERS)
    .filter(([, needs]) => !needs.some((provider) => providers.has(provider)))
    .map(([skill]) => skill)
}
