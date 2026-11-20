// How the fixture agent starts, and what a session's system prompt tells it.

/** What this agent offers when it starts. */
export const INITIALIZE = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: 'e2e-fixture', version: '1' },
  authMethods: [],
}

/** The E2E_RULE:<name> the system prompt a session is loaded with names (#4083). */
export const ruleIn = (params) =>
  /E2E_RULE:([a-z]+)/.exec(JSON.stringify(params._meta ?? {}))?.[1] ?? 'none'
