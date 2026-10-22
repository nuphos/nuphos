import { getTeamMembership } from '@/lib/identity'

import type { NuphosTeamRole } from '@/lib/identity'

// Paths that vend cloud or cluster access (keys, tokens, kubeconfigs,
// exec-credential bearer tokens, tailnet auth keys). SaaS
// work-tool tokens such as Linear or Jira are deliberately not matched.
const CLOUD_CREDENTIAL_PATH =
  /\/(?:aws-accounts|gcp-projects|cloudflare-accounts|linode-accounts|hetzner-accounts|tencent-accounts|aliyun-accounts|volcengine-accounts|huawei-accounts|azure-accounts|tailscale-clients|zeabur-providers)\/[^/]+\/(?:.+\/)?(?:credentials|kubeconfig|exec-credential|tailnet-sessions)$/u

export function isCloudCredentialPath(path: string): boolean {
  return CLOUD_CREDENTIAL_PATH.test(path)
}

/** Minting cloud credentials or kubeconfigs is a write-level capability, so
 * viewers get none. Agent runs pass every principal they act for (sender and
 * conversation owner); each must be an administrator or editor. */
export async function canMintCredentials(
  teamId: string,
  userIds: string[],
  roles: NuphosTeamRole[] = ['ADMINISTRATOR', 'EDITOR'],
): Promise<boolean> {
  for (const userId of new Set(userIds)) {
    const role = (await getTeamMembership(userId, teamId))?.role

    if (!role || !roles.includes(role)) return false
  }

  return true
}
