import { describe, expect, test } from 'bun:test'

import { useAgentKubeconfig } from '@/lib/test/doubles/agent-kubeconfig'

import type { AgentClusterContext } from '@/lib/byos/agent-kubeconfig'

let contexts: AgentClusterContext[] = []
let lastFresh: boolean | undefined

useAgentKubeconfig({
  agentSessionClusterContexts: (
    _userId: string,
    _sessionId: string,
    opts?: { fresh?: boolean },
  ) => {
    lastFresh = opts?.fresh

    return Promise.resolve(contexts.length === 0 ? null : { teamId: 'team-1', contexts })
  },
})

const { kubeconfigToolModule } = await import('./kubeconfig')

const ctx = { userId: 'user-1', teamId: 'team-1', sessionId: 'conv-1', locale: 'en' }

function getKubeconfig(args: Record<string, unknown> = {}) {
  const handler = kubeconfigToolModule({
    getCredentialAccess: () => Promise.resolve({}),
  }).handlers(ctx).get_kubeconfig

  if (!handler) throw new Error('get_kubeconfig handler missing')

  return handler(args)
}

describe('get_kubeconfig', () => {
  test('reports when the selection reaches no clusters', async () => {
    contexts = []
    const result = await getKubeconfig()

    expect(result.structuredContent).toMatchObject({ contexts: [] })
  })

  test('re-issues provider credentials only when asked', async () => {
    contexts = []
    await getKubeconfig()
    expect(lastFresh).toBe(false)
    await getKubeconfig({ fresh: true })
    expect(lastFresh).toBe(true)
  })

  test('rewrites exec contexts to a plugin that carries no Nuphos credential', async () => {
    contexts = [
      {
        contextName: 'aws/123456789012/prod',
        endpoint: 'https://eks.example',
        caBase64: 'Q0E=',
        execArgs: ['aws', 'team-1', '123456789012', 'prod', 'us-east-1'],
      },
      {
        contextName: 'linode/acc/lke1',
        endpoint: 'https://lke.example',
        caBase64: 'Q0E=',
        user: { token: 'embedded-long-lived' },
      },
    ]
    const result = await getKubeconfig()
    const payload = result.structuredContent as { contexts: string[]; kubeconfig: string }

    expect(payload.contexts).toEqual(['aws/123456789012/prod', 'linode/acc/lke1'])
    // The exec context calls back with the running turn's own token, never a
    // skills script, a general bearer, or a token written into the file.
    expect(payload.kubeconfig).toContain('exec-credential')
    expect(payload.kubeconfig).not.toContain('get-credential.sh')
    expect(payload.kubeconfig).toContain('OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN')
    expect(payload.kubeconfig).not.toMatch(/eyJ[\w-]+\.[\w-]+\./)
    expect(payload.kubeconfig).not.toContain('env:')
    // Positional args mirror get-credential.sh's contract (YAML may quote).
    for (const arg of ['aws', 'team-1', '123456789012', 'prod', 'us-east-1']) {
      expect(payload.kubeconfig).toMatch(new RegExp(`- "?${arg}"?\\n`))
    }
    // The embedded long-lived user block passes through untouched.
    expect(payload.kubeconfig).toContain('embedded-long-lived')
  })
})
