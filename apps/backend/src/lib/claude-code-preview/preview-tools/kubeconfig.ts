// Kubeconfig bootstrap for the Claude Code runtime: the same multi-cluster
// resolution the classic sandbox gets from sync-clusters.sh, rendered for a
// pod that has no skills directory and no general Nuphos bearer. Short-lived
// EKS/GKE credentials are fetched by an inline exec plugin carrying the
// conversation's scoped preview-MCP token — useless outside this
// conversation's own vending mount.
import { config as appConfig } from '@/config'
import { agentSessionClusterContexts } from '@/lib/byos/agent-kubeconfig'
import { renderAgentKubeconfig } from '@/lib/byos/agent-kubeconfig'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { mintPreviewMcpToken } from '../mcp-token'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { AgentCredentialAccess } from '@/lib/agent/db'
import type { AgentRef } from '@/lib/agents/identity'
import type { AgentClusterContext } from '@/lib/byos/agent-kubeconfig'

const TOKEN_TTL_SEC = 24 * 60 * 60

// Positional args mirror get-credential.sh: provider, teamId, account,
// cluster, region. Base/session/token ride exec `env` entries so the script
// stays constant.
const EXEC_SCRIPT = [
  'set -eu',
  'p="$1"; t="$2"; a="$3"; c="$4"; r="${5:-}"',
  'case "$p" in',
  '  aws) path="aws-accounts/$a/clusters/$c/exec-credential${r:+?region=$r}" ;;',
  '  gcp) path="gcp-projects/$a/clusters/$c/exec-credential${r:+?location=$r}" ;;',
  '  *) echo "unknown provider: $p" >&2; exit 1 ;;',
  'esac',
  'exec curl -sS --connect-timeout 10 --max-time 30 -H "Authorization: Bearer $NUPHOS_KUBE_TOKEN" "$NUPHOS_KUBE_BASE/agent-sessions/$NUPHOS_KUBE_SESSION/teams/$t/$path"',
].join('\n')

function withInlineExec(
  contexts: AgentClusterContext[],
  args: { base: string; sessionId: string; token: string },
): AgentClusterContext[] {
  return contexts.map((ctx) => {
    if (!ctx.execArgs) return ctx
    const { execArgs, ...rest } = ctx

    return {
      ...rest,
      user: {
        exec: {
          apiVersion: 'client.authentication.k8s.io/v1',
          command: 'bash',
          args: ['-c', EXEC_SCRIPT, 'nuphos-exec-credential', ...execArgs],
          env: [
            { name: 'NUPHOS_KUBE_BASE', value: args.base },
            { name: 'NUPHOS_KUBE_SESSION', value: args.sessionId },
            { name: 'NUPHOS_KUBE_TOKEN', value: args.token },
          ],
          interactiveMode: 'Never',
          provideClusterInfo: false,
        },
      },
    }
  })
}

export function kubeconfigToolModule(
  baseUrl?: string,
  dependencies: {
    getCredentialAccess: (
      agent: AgentRef,
      teamId: string,
    ) => Promise<Partial<AgentCredentialAccess>>
  } = { getCredentialAccess: getAgentCredentialAccess },
): PreviewToolModule {
  return {
    definitions: [
      {
        name: 'get_kubeconfig',
        description:
          'Fetch a ready-to-use multi-cluster kubeconfig covering every ' +
          'Kubernetes cluster this conversation’s selected credentials reach ' +
          '(EKS, GKE, and provider/on-prem clusters). Write the returned YAML ' +
          'to ~/.kube/config with mode 0600 and pass --context <name> on every ' +
          'kubectl/helm call — current-context is deliberately unset. ' +
          'Credentials renew themselves; if kubectl starts failing with ' +
          'authentication errors (the embedded grant lasts ~24h), call this ' +
          'tool again and rewrite the file.',
        inputSchema: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description:
                'Clear, concise description of what this call is for, in 5-10 ' +
                "words, in the user's language. Shown to the user as the step title.",
            },
            fresh: {
              type: 'boolean',
              description:
                'Re-issue provider credentials instead of reusing them. Only for a ' +
                'Volcengine VKE cluster that still returns an in-cluster 403 after ' +
                'the user granted RBAC: VKE binds RBAC when the credential is issued.',
            },
          },
        },
      },
    ],
    handlers: (ctx: PreviewToolContext) => ({
      get_kubeconfig: async (args) => {
        const base = baseUrl ?? appConfig.agent.backendUrl

        if (!base) return toolError('The backend has no reachable base URL configured.')
        const agent = {
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          ...(ctx.conversationOwnerUserId
            ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
            : {}),
        }
        const credentialAccess = await dependencies.getCredentialAccess(agent, ctx.teamId)
        const resolved = await agentSessionClusterContexts(ctx.userId, ctx.sessionId, {
          fresh: args.fresh === true,
          conversationOwnerUserId: ctx.conversationOwnerUserId,
          credentialAccess,
        })

        if (!resolved || resolved.contexts.length === 0) {
          return toolResult({
            contexts: [],
            message:
              'No Kubernetes clusters are reachable through the credentials ' +
              'selected for this conversation.',
          })
        }
        const token = mintPreviewMcpToken({
          userId: ctx.userId,
          conversationOwnerUserId: ctx.conversationOwnerUserId,
          sessionId: ctx.sessionId,
          teamId: resolved.teamId,
          apiOrigin: base,
          ttlSec: TOKEN_TTL_SEC,
        })
        const contexts = withInlineExec(resolved.contexts, {
          base: base.endsWith('/') ? base.slice(0, -1) : base,
          sessionId: ctx.sessionId,
          token,
        })

        return toolResult({
          contexts: contexts.map((item) => item.contextName),
          kubeconfig: renderAgentKubeconfig(contexts),
          instructions:
            'Write the kubeconfig value to ~/.kube/config (chmod 600) and use ' +
            'kubectl --context <name>. Re-run get_kubeconfig on auth errors.',
        })
      },
    }),
  }
}
