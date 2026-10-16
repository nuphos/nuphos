// Kubeconfig bootstrap for the Claude Code runtime: the same multi-cluster
// resolution the classic sandbox gets from sync-clusters.sh, rendered for a
// pod that has no skills directory and no general Nuphos bearer. Short-lived
// EKS/GKE credentials are fetched by an inline exec plugin that authorizes with
// the conversation token of whichever turn runs kubectl, so the file itself
// holds no Nuphos credential.
import { agentSessionClusterContexts } from '@/lib/byos/agent-kubeconfig'
import { renderAgentKubeconfig } from '@/lib/byos/agent-kubeconfig'
import { canMintCredentials } from '@/lib/byos/credential-role'
import { toolError, toolResult } from '@/lib/mcp/protocol'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { AgentCredentialAccess } from '@/lib/agent/db'
import type { AgentRef } from '@/lib/agents/identity'
import type { AgentClusterContext } from '@/lib/byos/agent-kubeconfig'

// Positional args mirror get-credential.sh: provider, teamId, account,
// cluster, region. Backend URL, session and token come from the turn's own
// environment; the runtime keeps the current token in OPENAB_CREDENTIALS_DIR.
const EXEC_SCRIPT = [
  'set -eu',
  'p="$1"; t="$2"; a="$3"; c="$4"; r="${5:-}"',
  'k="${NUPHOS_TOKEN:-}"',
  'if [ -n "${OPENAB_CREDENTIALS_DIR:-}" ] && [ -r "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" ]; then IFS= read -r k <"$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" || true; fi',
  '[ -n "$k" ] || { echo "no Nuphos conversation token in this environment" >&2; exit 1; }',
  '[ -n "${NUPHOS_BACKEND_URL:-}" ] && [ -n "${NUPHOS_SESSION_ID:-}" ] || { echo "NUPHOS_BACKEND_URL and NUPHOS_SESSION_ID are required" >&2; exit 1; }',
  'case "$p" in',
  '  aws) path="aws-accounts/$a/clusters/$c/exec-credential${r:+?region=$r}" ;;',
  '  gcp) path="gcp-projects/$a/clusters/$c/exec-credential${r:+?location=$r}" ;;',
  '  *) echo "unknown provider: $p" >&2; exit 1 ;;',
  'esac',
  'b="${NUPHOS_BACKEND_URL%/}"',
  'exec curl -sS --fail-with-body --connect-timeout 10 --max-time 30 -H @- "$b/agent-sessions/$NUPHOS_SESSION_ID/teams/$t/$path" <<EOF',
  'Authorization: Bearer $k',
  'EOF',
].join('\n')

function withInlineExec(contexts: AgentClusterContext[]): AgentClusterContext[] {
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
          interactiveMode: 'Never',
          provideClusterInfo: false,
        },
      },
    }
  })
}

export function kubeconfigToolModule(
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
          'authentication errors, call this tool again and rewrite the file.',
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
          const principals = [ctx.userId, ctx.conversationOwnerUserId ?? ctx.userId]

          if (!(await canMintCredentials(ctx.teamId, principals))) {
            return toolError(
              'Kubernetes access needs the Editor or Administrator team role for both the ' +
                'sender and the conversation owner.',
            )
          }

          return toolResult({
            contexts: [],
            message:
              'No Kubernetes clusters are reachable through the credentials ' +
              'selected for this conversation.',
          })
        }
        const contexts = withInlineExec(resolved.contexts)

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
