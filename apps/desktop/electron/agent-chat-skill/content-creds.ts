import { SHORT_LIVED_CREDS_HELPER_MAIN } from './creds-helper-main'
import { SHORT_LIVED_CREDS_HELPER_PRELUDE } from './creds-helper-prelude'

import type { AgentChatSkillTarget } from './types'

export function getShortLivedCredsSkillBody(target: AgentChatSkillTarget): string {
  const opener = target === 'codex' ? 'Codex' : 'Claude Code'

  return `---
name: get-short-lived-creds-from-nuphos
description: Fetch short-lived AWS, GCP, or Kubernetes credentials from Nuphos with curl so ${opener} can run cloud CLIs safely.
---

# Get Short-Lived Creds From Nuphos

Use this skill when you need temporary AWS STS credentials, a GCP access token, or a kubeconfig for a Nuphos-bound integration.

The helper calls Nuphos with \`curl\` and the token from the local Nuphos login at \`~/.config/nuphos/cli.yaml\`. \`NUPHOS_TOKEN\` is only a fallback for non-desktop environments. It uses \`NUPHOS_BACKEND_URL\` or \`NUPHOS_API_URL\`, defaulting to \`https://api.nuphos.ai\`. If \`NUPHOS_SESSION_ID\` is set, it uses the agent-session scoped endpoints.

## Commands

\`\`\`sh
# Discovery: use these first when IDs are unknown.
scripts/get-short-lived-creds-from-nuphos list teams
scripts/get-short-lived-creds-from-nuphos list aws-accounts --team-id <teamId>
scripts/get-short-lived-creds-from-nuphos list gcp-projects --team-id <teamId>
scripts/get-short-lived-creds-from-nuphos list aws-clusters --team-id <teamId> --account-id <awsAccountId> [--role-id <roleId>]
scripts/get-short-lived-creds-from-nuphos list gcp-clusters --team-id <teamId> --project-id <projectId> [--service-account-id <bindingId>]

# AWS: writes ~/.aws/credentials and ~/.aws/config by default.
scripts/get-short-lived-creds-from-nuphos aws --team-id <teamId> --account-id <awsAccountId> --region us-east-1

# GCP: writes a gcloud access-token config by default.
scripts/get-short-lived-creds-from-nuphos gcp --team-id <teamId> --project-id <projectId> [--service-account-id <bindingId>]

# Kubernetes: writes ~/.kube/config by default.
scripts/get-short-lived-creds-from-nuphos k8s --team-id <teamId> --provider aws --account-id <awsAccountId> --cluster <clusterName> [--region <region>]
scripts/get-short-lived-creds-from-nuphos k8s --team-id <teamId> --provider gcp --project-id <projectId> --cluster <clusterName> [--location <location>]
\`\`\`

Pass \`--format env\` for AWS or GCP when you want shell exports instead of writing CLI config files. Do not print or paste secret values into chat; use the helper output only in the shell that needs them.

When IDs are unknown, run the discovery commands first. Use \`team.id\`, AWS \`accountId\` plus optional \`roleId\`, GCP \`projectId\` plus optional \`serviceAccountId\`, and cluster \`name\` from the JSON output.

If a request returns 403, the current token or agent session is not allowed to use that integration. Ask the user or a team admin to enable access in Nuphos, then retry.
`
}

export const shortLivedCredsHelperScript =
  SHORT_LIVED_CREDS_HELPER_PRELUDE + SHORT_LIVED_CREDS_HELPER_MAIN
