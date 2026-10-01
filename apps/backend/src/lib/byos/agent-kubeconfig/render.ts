import YAML from 'yaml'

/**
 * The rendered kubeconfig ships into the sandbox before the backend knows the
 * sandbox's absolute skills path, so exec commands reference this placeholder
 * and sync-clusters.sh substitutes the real path on write.
 */
export const SKILLS_DIR_PLACEHOLDER = '__NUPHOS_SKILLS_DIR__'

export type AgentClusterContext = {
  /** Context, cluster, and user entry name — `<provider>/<account>/<cluster>`. */
  contextName: string
  endpoint: string
  caBase64: string
  /**
   * How the context authenticates. EKS and GKE mint short-lived tokens, so they
   * go through the exec plugin (`execArgs` are passed to get-credential.sh).
   * The other providers relay a self-contained kubeconfig whose credential is
   * long-lived, so its `user` block is embedded verbatim — no renewal needed,
   * and the agent cannot tell the two apart.
   */
  execArgs?: string[]
  user?: Record<string, unknown>
  /**
   * Set for clusters reached through the on-prem relay (apps/kube-relay). The
   * endpoint above is only routable inside the customer's network, so every
   * request has to go through the relay's CONNECT proxy — while the TLS session
   * stays end-to-end with their API server.
   *
   * Kept separate from proxyUrl because the URL embeds a per-session token:
   * enumeration is cached per team, the URL is minted per session.
   */
  relayClusterKey?: string
  proxyUrl?: string
}

/**
 * Pull the cluster endpoint, CA, and user block out of a provider-issued
 * kubeconfig (TKE/ACK/LKE/VKE/AKS all hand back a complete one). Returns null
 * when the document is missing any of them, or when the credential is an exec
 * plugin we cannot satisfy in the sandbox — AAD-integrated AKS returns a
 * kubelogin stanza, and a context that needs a binary we don't ship is worse
 * than no context at all.
 */
export function parseRelayedKubeconfig(text: string): {
  endpoint: string
  caBase64: string
  user: Record<string, unknown>
} | null {
  let doc: {
    clusters?: { cluster?: { server?: string; 'certificate-authority-data'?: string } }[]
    users?: { user?: Record<string, unknown> }[]
  }

  try {
    doc = YAML.parse(text) as typeof doc
  } catch {
    return null
  }
  const cluster = doc?.clusters?.[0]?.cluster
  const user = doc?.users?.[0]?.user
  const endpoint = cluster?.server
  const caBase64 = cluster?.['certificate-authority-data']

  if (!endpoint || !caBase64 || !user) return null
  if ('exec' in user) return null

  return { endpoint, caBase64, user }
}

function indentBlock(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)

  return text
    .trimEnd()
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n')
}

/**
 * Multi-cluster kubeconfig for the agent sandbox: one context per reachable
 * cluster and no embedded tokens. Credentials come from a kubeconfig exec
 * plugin (get-credential.sh) that fetches and renews them on demand, so the
 * config never goes stale. current-context is deliberately unset — the agent
 * must name its target with --context on every call.
 */
export function renderAgentKubeconfig(contexts: AgentClusterContext[]): string {
  const q = (value: string) => JSON.stringify(value)
  const lines: string[] = ['apiVersion: v1', 'kind: Config', 'clusters:']

  for (const ctx of contexts) {
    lines.push(
      `  - name: ${q(ctx.contextName)}`,
      '    cluster:',
      `      server: ${q(ctx.endpoint)}`,
      `      certificate-authority-data: ${q(ctx.caBase64)}`,
      ...(ctx.proxyUrl ? [`      proxy-url: ${q(ctx.proxyUrl)}`] : []),
    )
  }
  lines.push('contexts:')
  for (const ctx of contexts) {
    lines.push(
      `  - name: ${q(ctx.contextName)}`,
      '    context:',
      `      cluster: ${q(ctx.contextName)}`,
      `      user: ${q(ctx.contextName)}`,
    )
  }
  lines.push('users:')
  for (const ctx of contexts) {
    lines.push(`  - name: ${q(ctx.contextName)}`)
    if (ctx.execArgs) {
      const credentialScript = `${SKILLS_DIR_PLACEHOLDER}/kubectl/scripts/get-credential.sh`

      lines.push(
        '    user:',
        '      exec:',
        '        apiVersion: client.authentication.k8s.io/v1',
        '        command: bash',
        '        args:',
        `          - ${q(credentialScript)}`,
        ...ctx.execArgs.map((arg) => `          - ${q(arg)}`),
        '        interactiveMode: Never',
        '        provideClusterInfo: false',
      )
    } else if (ctx.user) {
      lines.push(indentBlock(YAML.stringify({ user: ctx.user }), 4))
    }
  }

  return `${lines.join('\n')}\n`
}
