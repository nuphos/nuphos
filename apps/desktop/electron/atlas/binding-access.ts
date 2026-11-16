import { call } from './client'

import type { BindingAccess, Team } from './teams'

/** The binding collections whose member list is edited through the generic routes. */
const COLLECTIONS = new Set([
  'asana-accounts',
  'cloudflare-accounts',
  'github-installations',
  'gitlab-bindings',
  'grafana-instances',
  'hetzner-accounts',
  'jira-sites',
  'linear-workspaces',
  'linode-accounts',
  'notion-integrations',
  'onprem-clusters',
  'resend-integrations',
  'secureframe-integrations',
  'sentry-accounts',
  'sonarqube-integrations',
  'tailscale-clients',
  'uptime-kuma-instances',
  'vanta-integrations',
])

function accessPath(teamId: string, collection: string, bindingId: string): string {
  if (!COLLECTIONS.has(collection) || !/^[\w-]{1,64}$/u.test(bindingId)) {
    throw new Error(`Unknown binding ${collection}/${bindingId}`)
  }
  // On-prem clusters use /access for what the cluster credential can do.
  const leaf = collection === 'onprem-clusters' ? 'member-access' : 'access'

  return `/teams/${teamId}/${collection}/${encodeURIComponent(bindingId)}/${leaf}`
}

export async function getBindingAccess(
  teamId: string,
  collection: string,
  bindingId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', accessPath(teamId, collection, bindingId))
}

export async function updateBindingAccess(
  teamId: string,
  collection: string,
  bindingId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', accessPath(teamId, collection, bindingId), access)
}

/** Whether bindings connected from now on start shared with the whole team. */
export async function setTeamBindingShareDefault(
  teamId: string,
  share: 'private' | 'team',
): Promise<Team> {
  return call<Team>('PUT', `/teams/${teamId}/binding-share-default`, { share }, { retry: false })
}
