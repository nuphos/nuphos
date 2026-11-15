/**
 * The agents a computer can run itself, in the order its + menu offers them. The desktop
 * host reads the same list; team runtimes can run more (`AgentProvider`).
 */
export const LOCAL_AGENT_PROVIDERS = [
  'claude-code',
  'codex',
  'grok',
  'antigravity',
  'opencode',
  'dsh',
  'hermes',
] as const

export type LocalAgentProvider = (typeof LOCAL_AGENT_PROVIDERS)[number]
