// The seam every chat bridge (Slack, Lark, Discord) runs turns
// through, instead of importing `@/routes/agent` directly.
//
// Two constraints shape this file:
//  - `@/routes/agent` is loaded lazily because it transitively imports the
//    bridges that call back into here.
//  - Every method resolves its implementation at call time, so a test that
//    installs a fake in `beforeEach` is honoured no matter which file the
//    runner loaded first. `mock.module` cannot do this: consumers bind the
//    module's exports at import time, so the winner is decided by load order
//    and four suites mocking `@/routes/agent` silently stole each other's
//    recorders.
type AgentRoutes = typeof import('@/routes/agent')

export type TurnRunner = {
  runAgentForTrigger: AgentRoutes['runAgentForTrigger']
  claimAgentRunOrEnqueue: AgentRoutes['claimAgentRunOrEnqueue']
  claimAgentRunForSession: AgentRoutes['claimAgentRunForSession']
  hasActiveAgentRunForSession: AgentRoutes['hasActiveAgentRunForSession']
}

let installed: Partial<TurnRunner> | null = null

async function resolve<K extends keyof TurnRunner>(name: K): Promise<TurnRunner[K]> {
  const override = installed?.[name]

  if (override) return override as TurnRunner[K]

  return (await import('@/routes/agent'))[name]
}

export const turnRunner: TurnRunner = {
  runAgentForTrigger: async (params) => (await resolve('runAgentForTrigger'))(params),
  claimAgentRunOrEnqueue: async (args) => (await resolve('claimAgentRunOrEnqueue'))(args),
  claimAgentRunForSession: async (userId, sessionId) =>
    (await resolve('claimAgentRunForSession'))(userId, sessionId),
  hasActiveAgentRunForSession: async (userId, sessionId) =>
    (await resolve('hasActiveAgentRunForSession'))(userId, sessionId),
}

/**
 * Test-only. Call from `beforeEach` — omitted methods fall through to the real
 * implementation, so a suite installs only what it asserts on.
 */
export function installTurnRunner(fake: Partial<TurnRunner>): void {
  installed = fake
}

/** Test-only. Restores every method to the real implementation. */
export function resetTurnRunner(): void {
  installed = null
}
